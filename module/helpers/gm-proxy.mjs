/**
 * ALTERAÇÕES EM FICHAS DE TERCEIROS (dano, cura, efeitos, condições).
 *
 * Um jogador não tem — e não deve ter — permissão para abrir a ficha de um
 * NPC ou de outro jogador. Mas as ações dele precisam aplicar dano, efeitos e
 * condições nesses alvos.
 *
 * A solução aqui é um RELÉ pelo Mestre: quando o usuário não é dono do alvo,
 * o pedido de alteração é enviado por socket e executado no cliente do Mestre,
 * que já tem permissão sobre tudo. Nada de permissão temporária — o jogador
 * nunca ganha acesso à ficha, então não há janela em que ele possa abri-la
 * nem risco de o mundo ficar com permissões trocadas se algo falhar no meio.
 *
 * Por segurança, o Mestre só executa alterações nos caminhos da lista branca
 * abaixo: recursos, efeitos aplicados e condições. Um pedido que tente mexer
 * em qualquer outra coisa é descartado e registrado no console.
 */

const SOCKET = "system.ligeia-rpg";

/** Caminhos que o relé aceita alterar numa ficha de terceiro. */
const CAMINHOS_PERMITIDOS = [
  "system.resources.",
  "system.appliedEffects",
  "system.conditions",
];

/** Pedidos aguardando resposta: requestId → resolve. */
const pendentes = new Map();

/** Apenas UM Mestre processa os pedidos (evita aplicar em duplicidade). */
function mestreResponsavel() {
  const gms = game.users?.filter((u) => u.isGM && u.active) || [];
  if (!gms.length) return null;
  return gms.sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** A alteração mexe apenas no que o relé aceita? */
function alteracaoPermitida(update) {
  const chaves = Object.keys(update || {});
  if (!chaves.length) return false;
  return chaves.every((k) => CAMINHOS_PERMITIDOS.some((p) => k === p || k.startsWith(p)));
}

/**
 * Aplica uma alteração numa ficha, repassando ao Mestre quando o usuário não
 * é dono dela.
 *
 * @param {Actor} actor
 * @param {object} update  alterações (só caminhos da lista branca)
 * @param {object} [options]  opções do update
 * @returns {Promise<{ok:boolean, direct?:boolean, relayed?:boolean,
 *          noGM?:boolean, timeout?:boolean, refused?:boolean}>}
 */
export async function updateActorAsGM(actor, update, options = {}, timeoutMs = 15000) {
  if (!actor) return { ok: false };

  // Dono da ficha (o próprio personagem, ou o Mestre): aplica direto.
  if (actor.isOwner) {
    await actor.update(update, options);
    return { ok: true, direct: true };
  }

  if (!alteracaoPermitida(update)) {
    console.warn("Ligeia | alteração fora da lista branca não foi repassada ao Mestre:", update);
    return { ok: false, refused: true };
  }

  const gm = mestreResponsavel();
  if (!gm) return { ok: false, noGM: true };

  const requestId = foundry.utils.randomID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendentes.delete(requestId);
      resolve({ ok: false, timeout: true });
    }, timeoutMs);
    pendentes.set(requestId, (res) => {
      clearTimeout(timer);
      pendentes.delete(requestId);
      resolve(res);
    });
    game.socket?.emit(SOCKET, {
      type: "actorUpdateRequest",
      requestId,
      userId: gm.id,
      fromUserId: game.user.id,
      actorUuid: actor.uuid,
      update,
      options,
    });
  });
}

/** O usuário consegue alterar esta ficha (direto ou pelo Mestre)? */
export function canAffectActor(actor) {
  if (!actor) return false;
  return actor.isOwner || !!mestreResponsavel();
}

/** Registra o receptor dos pedidos (executado no cliente do Mestre). */
export function registerGmProxySocket() {
  game.socket?.on(SOCKET, async (payload) => {
    // --- Lado do Mestre: executa o pedido ---
    if (payload?.type === "actorUpdateRequest") {
      if (payload.userId !== game.user.id) return;
      let ok = false;
      let error = null;
      try {
        if (!alteracaoPermitida(payload.update)) {
          error = "alteração fora da lista branca";
        } else {
          const actor = await fromUuid(payload.actorUuid);
          if (!actor) error = "ficha não encontrada";
          else {
            await actor.update(payload.update, payload.options || {});
            ok = true;
          }
        }
      } catch (e) {
        error = e?.message || String(e);
        console.warn("Ligeia | falha ao aplicar alteração pedida por um jogador:", e);
      }
      game.socket?.emit(SOCKET, {
        type: "actorUpdateResponse",
        requestId: payload.requestId,
        userId: payload.fromUserId,
        ok,
        error,
      });
      return;
    }

    // --- Lado de quem pediu: recebe a resposta ---
    if (payload?.type === "actorUpdateResponse") {
      if (payload.userId !== game.user.id) return;
      pendentes.get(payload.requestId)?.({ ok: !!payload.ok, relayed: true, error: payload.error });
    }
  });
}
