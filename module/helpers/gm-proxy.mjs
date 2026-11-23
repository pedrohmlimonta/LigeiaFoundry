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
      const { tokenId, actorId } = await criarTokenConjurado(cena, pedido);
      return { ok: true, direct: true, tokenId, actorId };
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
        // Ficha própria para esta criatura (o padrão), e a ordem dela na
        // leva — é o que numera "Lobo 2", "Lobo 3".
        ownSheet: pedido?.ownSheet !== false,
        ordem: Number(pedido?.ordem) || 0,
      },
    });
  });
}

/**
 * Monta e cria o token da criatura conjurada. Roda em quem tem permissão de
 * criar na cena (o Mestre, ou o próprio jogador num mundo permissivo).
 * @returns {Promise<string>} id do token criado
 */
/** Nome da pasta onde as fichas das criaturas conjuradas são guardadas. */
const PASTA_CONJURADOS = "Conjurados";

/**
 * A pasta de conjurados, criada na primeira vez que alguém conjura.
 * Sem pasta a criação não falha — a ficha só fica na raiz.
 */
async function pastaDeConjurados() {
  try {
    const existente = globalThis.game?.folders?.find?.(
      (f) => f.type === "Actor" && f.name === PASTA_CONJURADOS,
    );
    if (existente) return existente.id;
    const nova = await Folder.create({ name: PASTA_CONJURADOS, type: "Actor", color: "#6a4ba8" });
    return nova?.id || null;
  } catch (e) {
    console.warn("Ligeia | não consegui criar a pasta de conjurados:", e);
    return null;
  }
}

/**
 * Cria uma FICHA PRÓPRIA para uma criatura conjurada.
 *
 * Cada invocação ganha a sua: três lobos são três fichas, com PV, condições
 * e efeitos independentes — nada de um lobo ferido arrastar os outros dois
 * no combate. A ficha é uma cópia da original, marcada como conjurada, e é
 * apagada quando a criatura é dispensada ou morre.
 *
 * @returns {Promise<Actor|null>} a ficha nova (ou null se não deu)
 */
async function criarFichaConjurada(ficha, pedido, ordem = 0) {
  try {
    const dados = ficha.toObject();
    delete dados._id;
    delete dados.folder;
    dados.name = ordem > 0 ? `${ficha.name} ${ordem + 1}` : ficha.name;
    dados.folder = await pastaDeConjurados();
    // Marca de nascença: é por ela que a faxina sabe o que pode apagar.
    dados.flags = dados.flags || {};
    dados.flags["ligeia-rpg"] = {
      ...(dados.flags["ligeia-rpg"] || {}),
      summoned: {
        sourceUuid: ficha.uuid,
        summonerUuid: pedido.summonFlag?.summonerUuid || "",
        createdAt: Date.now(),
      },
    };
    // Quem conjurou comanda a criatura que chamou — numa ficha própria a
    // posse é limpa, sem mexer na ficha de origem nem no resto do mundo.
    const dono = pedido.controlUserId && globalThis.game?.users?.get?.(pedido.controlUserId);
    if (dono && !dono.isGM) {
      dados.ownership = { ...(dados.ownership || {}), [dono.id]: 3 };
    }
    return await Actor.create(dados);
  } catch (e) {
    console.warn("Ligeia | falha ao criar a ficha da criatura conjurada:", e);
    return null;
  }
}

async function criarTokenConjurado(cena, pedido) {
  const origem = await fromUuid(pedido.actorUuid);
  if (!origem || origem.documentName !== "Actor") throw new Error("ficha não encontrada");

  // FICHA PRÓPRIA: por padrão cada criatura conjurada ganha a sua, para que
  // duas cópias da mesma criatura não dividam PV no meio do combate. Se a
  // criação falhar, segue-se com a ficha de origem e um token avulso.
  const propria = pedido.ownSheet !== false ? await criarFichaConjurada(origem, pedido, pedido.ordem || 0) : null;
  const ficha = propria || origem;

  // O token sai da própria ficha: tamanho, arte e barras vêm dela.
  const base = await ficha.getTokenDocument({}, { parent: cena });
  const dados = base.toObject();
  const gs = globalThis.canvas?.grid?.size || cena.grid?.size || 100;
  dados.x = Math.round((Number(pedido.center?.x) || 0) - ((dados.width ?? 1) * gs) / 2);
  dados.y = Math.round((Number(pedido.center?.y) || 0) - ((dados.height ?? 1) * gs) / 2);
  // Com ficha própria o token é VINCULADO a ela (o que acontece no token
  // acontece na ficha, e vice-versa). Sem ficha própria, o token é avulso,
  // para não mexer na ficha de origem.
  dados.actorLink = !!propria;
  dados.actorId = ficha.id;
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
  if (dono && !dono.isGM && !propria) {
    try {
      dados.delta = { ...(dados.delta || {}), ownership: { [dono.id]: 3 } };
    } catch (e) { /* o Mestre fica com o controle */ }
  }

  const criados = await cena.createEmbeddedDocuments("Token", [dados]);
  const tokenId = criados?.[0]?.id || "";
  // A ficha que nasceu sem token na cena não deve sobrar por aí.
  if (propria && !tokenId) {
    try { await propria.delete(); } catch (e) { /* ignora */ }
    return { tokenId: "", actorId: "" };
  }
  return { tokenId, actorId: propria?.id || "" };
}

/**
 * DISPENSAR o que uma conjuração pôs em campo: os tokens, os combatentes
 * deles e as fichas próprias que nasceram com eles.
 *
 * Como criar, dispensar precisa de permissão que o jogador não tem, então o
 * caminho é o mesmo relé. É tolerante: o que já saiu por outro caminho
 * simplesmente não está mais lá.
 *
 * @param {object} pedido { sceneId, tokenIds, actorIds }
 */
export async function dismissSummonAsGM(pedido, timeoutMs = 15000) {
  if (globalThis.game?.user?.isGM) {
    await executarDispensa(pedido);
    return { ok: true, direct: true };
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
      type: "summonDismissRequest",
      requestId,
      userId: gm.id,
      fromUserId: game.user.id,
      pedido: {
        sceneId: String(pedido?.sceneId || ""),
        tokenIds: (pedido?.tokenIds || []).map(String),
        actorIds: (pedido?.actorIds || []).map(String),
      },
    });
  });
}

/**
 * Tira de cena o que a conjuração pôs. Roda em quem tem permissão (o Mestre).
 *
 * A ordem importa: primeiro o combatente sai da iniciativa, depois o token
 * sai do mapa e só então a ficha é apagada — apagar a ficha antes deixaria
 * o token órfão por um instante.
 *
 * Só apaga ficha MARCADA como conjurada: um id errado (ou forjado) nunca
 * leva embora a ficha de ninguém.
 */
async function executarDispensa(pedido) {
  const cena = globalThis.game?.scenes?.get?.(pedido?.sceneId) || globalThis.canvas?.scene;
  const tokenIds = (pedido?.tokenIds || []).filter(Boolean);
  const actorIds = (pedido?.actorIds || []).filter(Boolean);

  for (const combate of globalThis.game?.combats ?? []) {
    const combatentes = (combate.combatants || []).filter((c) => tokenIds.includes(c.tokenId));
    if (!combatentes.length) continue;
    try { await combate.deleteEmbeddedDocuments("Combatant", combatentes.map((c) => c.id)); }
    catch (e) { console.warn("Ligeia | falha ao tirar a criatura da iniciativa:", e); }
  }

  const presentes = tokenIds.filter((id) => cena?.tokens?.get?.(id));
  if (cena && presentes.length) {
    try { await cena.deleteEmbeddedDocuments("Token", presentes); }
    catch (e) { console.warn("Ligeia | falha ao dispensar a criatura conjurada:", e); }
  }

  for (const id of actorIds) {
    const ficha = globalThis.game?.actors?.get?.(id);
    if (!ficha) continue;
    // A trava: ficha sem a marca de conjurada não é apagada, aconteça o que
    // acontecer. O que se cria aqui é o que se tira aqui.
    const marca = ficha.getFlag?.("ligeia-rpg", "summoned") ?? ficha.flags?.["ligeia-rpg"]?.summoned;
    if (!marca) continue;
    try { await ficha.delete(); }
    catch (e) { console.warn("Ligeia | falha ao apagar a ficha da criatura conjurada:", e); }
  }
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
      let actorId = "";
      try {
        const cena = game.scenes.get(payload.pedido?.sceneId);
        if (!cena) error = "cena não encontrada";
        else {
          ({ tokenId, actorId } = await criarTokenConjurado(cena, payload.pedido || {}));
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
        ok, error, tokenId, actorId,
      });
      return;
    }

    // --- Lado do Mestre: dispensa o que a conjuração pôs ---
    if (payload?.type === "summonDismissRequest") {
      if (payload.userId !== game.user.id) return;
      let ok = false;
      let error = null;
      try {
        await executarDispensa(payload.pedido || {});
        ok = true;
      } catch (e) {
        error = e?.message || String(e);
        console.warn("Ligeia | falha ao dispensar a pedido de um jogador:", e);
      }
      game.socket?.emit(SOCKET, {
        type: "summonDismissResponse",
        requestId: payload.requestId,
        userId: payload.fromUserId,
        ok, error,
      });
      return;
    }

    if (payload?.type === "summonDismissResponse") {
      if (payload.userId !== game.user.id) return;
      pendentes.get(payload.requestId)?.({ ok: !!payload.ok, relayed: true, error: payload.error });
      return;
    }

    if (payload?.type === "summonResponse") {
      if (payload.userId !== game.user.id) return;
      pendentes.get(payload.requestId)?.({
        ok: !!payload.ok, relayed: true, error: payload.error,
        tokenId: payload.tokenId, actorId: payload.actorId,
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
