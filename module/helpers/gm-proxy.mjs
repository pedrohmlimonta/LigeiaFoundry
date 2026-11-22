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

/**
 * CONJURAÇÃO: cria um token a partir de uma ficha, na posição escolhida.
 *
 * Um jogador não tem permissão para criar tokens numa cena, então o pedido
 * vai pelo mesmo relé. O que viaja pela rede é só o essencial — a ficha, a
 * cena, o ponto, a atitude e a duração. O cliente do Mestre é que monta os
 * dados do token a partir da ficha, de modo que um pedido forjado não
 * consegue inventar um token com o que quiser dentro.
 *
 * @param {object} pedido
 * @param {string} pedido.actorUuid   ficha a conjurar
 * @param {string} pedido.sceneId     cena onde o token aparece
 * @param {{x:number,y:number}} pedido.center  centro escolhido (px)
 * @param {number|null} [pedido.disposition]   atitude (CONST.TOKEN_DISPOSITIONS)
 * @param {boolean} [pedido.hidden]            entra escondido
 * @param {string} [pedido.controlUserId]      quem recebe o controle
 * @param {object} [pedido.summonFlag]         marca de conjuração (duração)
 * @returns {Promise<{ok:boolean, tokenId?:string, direct?:boolean,
 *          relayed?:boolean, noGM?:boolean, timeout?:boolean, error?:string}>}
 */
export async function createSummonAsGM(pedido, timeoutMs = 15000) {
  const cena = globalThis.game?.scenes?.get?.(pedido?.sceneId);
  // Quem já pode criar tokens na cena (o Mestre) cria na hora.
  if (cena && (game.user.isGM || cena.canUserModify?.(game.user, "create"))) {
    try {
      const tokenId = await criarTokenConjurado(cena, pedido);
      return { ok: true, direct: true, tokenId };
    } catch (e) {
      console.warn("Ligeia | falha ao conjurar:", e);
      return { ok: false, error: e?.message || String(e) };
    }
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
      type: "summonRequest",
      requestId,
      userId: gm.id,
      fromUserId: game.user.id,
      pedido: {
        actorUuid: String(pedido?.actorUuid || ""),
        sceneId: String(pedido?.sceneId || ""),
        center: { x: Number(pedido?.center?.x) || 0, y: Number(pedido?.center?.y) || 0 },
        disposition: pedido?.disposition ?? null,
        hidden: !!pedido?.hidden,
        controlUserId: String(pedido?.controlUserId || ""),
        summonFlag: pedido?.summonFlag || null,
      },
    });
  });
}

/**
 * Monta e cria o token da criatura conjurada. Roda em quem tem permissão de
 * criar na cena (o Mestre, ou o próprio jogador num mundo permissivo).
 * @returns {Promise<string>} id do token criado
 */
async function criarTokenConjurado(cena, pedido) {
  const ficha = await fromUuid(pedido.actorUuid);
  if (!ficha || ficha.documentName !== "Actor") throw new Error("ficha não encontrada");

  // O token sai da própria ficha: tamanho, arte e barras vêm dela.
  const base = await ficha.getTokenDocument({}, { parent: cena });
  const dados = base.toObject();
  const gs = globalThis.canvas?.grid?.size || cena.grid?.size || 100;
  dados.x = Math.round((Number(pedido.center?.x) || 0) - ((dados.width ?? 1) * gs) / 2);
  dados.y = Math.round((Number(pedido.center?.y) || 0) - ((dados.height ?? 1) * gs) / 2);
  // Conjuração não mexe na ficha original: o token é avulso.
  dados.actorLink = false;
  if (pedido.disposition != null) dados.disposition = Number(pedido.disposition);
  if (pedido.hidden) dados.hidden = true;
  dados.flags = dados.flags || {};
  dados.flags["ligeia-rpg"] = {
    ...(dados.flags["ligeia-rpg"] || {}),
    ...(pedido.summonFlag ? { summon: pedido.summonFlag } : {}),
  };
  // Controle para quem conjurou: a posse vive na ficha avulsa do token
  // (o delta), e não na ficha original — assim o jogador comanda a criatura
  // que invocou sem ganhar acesso ao resto do mundo. Se a versão do Foundry
  // não aceitar, o Mestre segue no controle e a conjuração acontece igual.
  const dono = pedido.controlUserId && globalThis.game?.users?.get?.(pedido.controlUserId);
  if (dono && !dono.isGM) {
    try {
      dados.delta = { ...(dados.delta || {}), ownership: { [dono.id]: 3 } };
    } catch (e) { /* o Mestre fica com o controle */ }
  }

  const criados = await cena.createEmbeddedDocuments("Token", [dados]);
  return criados?.[0]?.id || "";
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

    // --- Lado do Mestre: conjura a criatura pedida por um jogador ---
    if (payload?.type === "summonRequest") {
      if (payload.userId !== game.user.id) return;
      let ok = false;
      let error = null;
      let tokenId = "";
      try {
        const cena = game.scenes.get(payload.pedido?.sceneId);
        if (!cena) error = "cena não encontrada";
        else {
          tokenId = await criarTokenConjurado(cena, payload.pedido || {});
          ok = true;
        }
      } catch (e) {
        error = e?.message || String(e);
        console.warn("Ligeia | falha ao conjurar a pedido de um jogador:", e);
      }
      game.socket?.emit(SOCKET, {
        type: "summonResponse",
        requestId: payload.requestId,
        userId: payload.fromUserId,
        ok, error, tokenId,
      });
      return;
    }

    if (payload?.type === "summonResponse") {
      if (payload.userId !== game.user.id) return;
      pendentes.get(payload.requestId)?.({
        ok: !!payload.ok, relayed: true, error: payload.error, tokenId: payload.tokenId,
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
