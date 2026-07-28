/**
 * Caixa de rolagem REMOTA.
 *
 * Quando um ataque exige a rolagem de defesa do alvo, quem decide os ajustes
 * (bônus, dados de melhoria) é quem CONTROLA o alvo — não o atacante. Este
 * módulo pede, via socket, que o dono do ator abra a caixa de rolagem e
 * devolve a configuração escolhida.
 *
 * Regras de quem responde:
 *   1. Um jogador ATIVO com permissão de dono sobre o ator (preferindo aquele
 *      que tem o ator como personagem designado);
 *   2. Não havendo (caso típico de NPC), o Mestre ativo responsável.
 * Se o responsável for o próprio usuário atual, a caixa abre localmente, sem
 * passar pelo socket.
 */
import { promptRollConfig } from "../apps/roll-dialog.mjs";

const SOCKET = "system.ligeia-rpg";

/** Pedidos aguardando resposta: requestId → resolve. */
const pending = new Map();

/** Mestre ativo responsável (o mesmo critério do movimento: menor id). */
function responsibleGM() {
  const gms = game.users.filter((u) => u.isGM && u.active);
  if (!gms.length) return null;
  return gms.sort((a, b) => a.id.localeCompare(b.id))[0];
}

/**
 * Usuário que deve responder pela ficha (abrir a caixa de rolagem).
 * @returns {User|null}
 */
export function responderUserFor(actor) {
  if (!actor) return null;
  const owners = game.users.filter(
    (u) => u.active && !u.isGM && actor.testUserPermission?.(u, "OWNER"),
  );
  if (owners.length) {
    const primary = owners.find((u) => u.character?.id === actor.id);
    return primary || owners[0];
  }
  return responsibleGM();
}

/**
 * Pede a configuração de rolagem para o dono do ator.
 * @param {Actor} actor  dono da rolagem (quem vai rolar)
 * @param {object} opts  opções do promptRollConfig
 * @param {number} timeoutMs  tempo máximo de espera (padrão 60s)
 * @returns {Promise<object|null>} config escolhida, ou null (sem resposta,
 *          cancelado ou sem ninguém para responder) — o chamador então rola
 *          com os valores padrão.
 */
export async function requestRollConfig(actor, opts = {}, timeoutMs = 60000) {
  const user = responderUserFor(actor);
  if (!user) return null;

  // Sou eu mesmo quem controla: abre localmente (socket não entrega a si).
  if (user.id === game.user.id) return await promptRollConfig(opts);

  const requestId = foundry.utils.randomID();
  ui.notifications?.info(`Aguardando a rolagem de ${actor.name} (${user.name})...`);

  return new Promise((resolve) => {
    const finish = (cfg) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(cfg);
    };
    const timer = setTimeout(() => {
      ui.notifications?.warn(`${user.name} não respondeu a tempo — rolando com os valores padrão.`);
      finish(null);
    }, timeoutMs);
    pending.set(requestId, finish);
    game.socket?.emit(SOCKET, {
      type: "rollConfigRequest",
      requestId,
      userId: user.id,
      fromUserId: game.user.id,
      opts,
    });
  });
}

/** Registra o receptor de pedidos/respostas de caixa de rolagem. */
export function registerRollRequestSocket() {
  game.socket?.on(SOCKET, async (payload) => {
    // Pedido: sou eu quem deve abrir a caixa.
    if (payload?.type === "rollConfigRequest") {
      if (payload.userId !== game.user.id) return;
      let cfg = null;
      try { cfg = await promptRollConfig(payload.opts || {}); }
      catch (e) { cfg = null; }
      game.socket?.emit(SOCKET, {
        type: "rollConfigResponse",
        requestId: payload.requestId,
        userId: payload.fromUserId,
        cfg,
      });
      return;
    }
    // Resposta ao meu pedido.
    if (payload?.type === "rollConfigResponse") {
      if (payload.userId !== game.user.id) return;
      pending.get(payload.requestId)?.(payload.cfg || null);
    }
  });
}
