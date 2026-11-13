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

/**
 * Caminhos que o relé aceita alterar num ITEM de terceiro.
 * Encantar o item de outro personagem é uma ação legítima de jogador, mas
 * ninguém pode mexer no resto da ficha do item por essa via.
 */
const CAMINHOS_ITEM_PERMITIDOS = [
  "system.enchantments",
];

/** Pedidos aguardando resposta: requestId → resolve. */
const pendentes = new Map();

/** Apenas UM Mestre processa os pedidos (evita aplicar em duplicidade). */
function mestreResponsavel() {
  const gms = globalThis.game?.users?.filter((u) => u.isGM && u.active) || [];
  if (!gms.length) return null;
  return gms.sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** A alteração mexe apenas no que o relé aceita? */
function alteracaoPermitida(update, lista = CAMINHOS_PERMITIDOS) {
  const chaves = Object.keys(update || {});
  if (!chaves.length) return false;
  return chaves.every((k) => lista.some((p) => k === p || k.startsWith(p)));
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
  return updateDocAsGM(actor, "actor", update, options, CAMINHOS_PERMITIDOS, timeoutMs);
}

/**
 * Aplica uma alteração num ITEM, repassando ao Mestre quando o usuário não é
 * dono dele. É o caminho de ENCANTAR o item de outro personagem: o jogador
 * escolhe o item na hora, mas quem grava é o Mestre.
 *
 * @param {Item} item
 * @param {object} update  alterações (só caminhos de CAMINHOS_ITEM_PERMITIDOS)
 * @param {object} [options]
 * @returns {Promise<{ok:boolean, direct?:boolean, relayed?:boolean,
 *          noGM?:boolean, timeout?:boolean, refused?:boolean}>}
 */
export async function updateItemAsGM(item, update, options = {}, timeoutMs = 15000) {
  return updateDocAsGM(item, "item", update, options, CAMINHOS_ITEM_PERMITIDOS, timeoutMs);
}

/** Miolo comum: aplica direto se for dono, senão pede ao Mestre. */
async function updateDocAsGM(doc, kind, update, options, lista, timeoutMs) {
  if (!doc) return { ok: false };

  // Dono do documento (o próprio personagem, ou o Mestre): aplica direto.
  if (doc.isOwner) {
    await doc.update(update, options);
    return { ok: true, direct: true };
  }

  if (!alteracaoPermitida(update, lista)) {
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
      // O nome do pedido não mudou: um cliente ainda na versão antiga do
      // sistema continua entendendo (e atendendo) os pedidos de ficha.
      type: "actorUpdateRequest",
      requestId,
      userId: gm.id,
      fromUserId: game.user.id,
      actorUuid: doc.uuid,
      kind,
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
        // Cada tipo de documento tem a sua própria lista branca.
        const ehItem = payload.kind === "item";
        const lista = ehItem ? CAMINHOS_ITEM_PERMITIDOS : CAMINHOS_PERMITIDOS;
        if (!alteracaoPermitida(payload.update, lista)) {
          error = "alteração fora da lista branca";
        } else {
          const doc = await fromUuid(payload.actorUuid);
          if (!doc) error = ehItem ? "item não encontrado" : "ficha não encontrada";
          else if (ehItem && doc.documentName !== "Item") error = "o pedido não aponta para um item";
          else if (!ehItem && doc.documentName !== "Actor") error = "o pedido não aponta para uma ficha";
          else {
            await doc.update(payload.update, payload.options || {});
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
