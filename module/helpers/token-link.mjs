/**
 * VÍNCULO ENTRE A FICHA DO TOKEN E A FICHA DO ATOR.
 *
 * Por padrão o Foundry cria tokens DESVINCULADOS: cada token guarda uma
 * cópia própria da ficha, então o dano sofrido no token não aparece na ficha
 * da aba Atores (e vice-versa). Neste sistema o comportamento desejado é o
 * oposto — token e ator são a MESMA ficha —, então:
 *
 *   1. atores novos nascem com o token vinculado (actorLink = true);
 *   2. tokens colocados na cena nascem vinculados;
 *   3. o mundo existente é migrado uma vez, preservando os valores atuais
 *      dos tokens que já estavam em jogo.
 *
 * O Mestre pode desligar tudo isso na configuração do sistema — útil se
 * quiser vários tokens do MESMO ator com vidas independentes (capangas),
 * já que tokens vinculados compartilham a ficha (e, portanto, os PV).
 */

const SYSTEM = "ligeia-rpg";
export const LINK_SETTING = "linkTokenActors";

/** O vínculo automático está ligado? */
function linkEnabled() {
  try { return game.settings.get(SYSTEM, LINK_SETTING) !== false; }
  catch (e) { return true; }
}

/** Registra a configuração do sistema (chamado no init). */
export function registerTokenLinkSettings() {
  game.settings.register(SYSTEM, LINK_SETTING, {
    name: "Vincular fichas de token ao ator",
    hint:
      "Token e ficha do ator são a mesma ficha: dano e gastos feitos no token aparecem na aba Atores e vice-versa. " +
      "Desligue se quiser vários tokens do mesmo ator com PV independentes (capangas).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

/** Hooks que mantêm atores e tokens novos sempre vinculados. */
export function registerTokenLinkHooks() {
  // Ator novo: o token padrão dele já nasce vinculado.
  Hooks.on("preCreateActor", (actor) => {
    if (!linkEnabled()) return;
    if (actor.prototypeToken?.actorLink) return;
    actor.updateSource({ "prototypeToken.actorLink": true });
  });

  // Token colocado na cena: vinculado (cobre atores antigos cujo protótipo
  // ainda não foi migrado).
  Hooks.on("preCreateToken", (token) => {
    if (!linkEnabled()) return;
    if (token.actorLink) return;
    token.updateSource({ actorLink: true });
  });
}

/**
 * Migra o mundo existente: vincula os protótipos e os tokens já colocados.
 * Quando um ator tem UM único token desvinculado em jogo, os recursos atuais
 * daquele token (PV, PM, heroicos, sobrevida e condições) são copiados para
 * a ficha do ator antes do vínculo — assim o dano já sofrido não se perde.
 * Havendo vários tokens do mesmo ator, não há como escolher entre eles: os
 * tokens são vinculados e passam a usar os valores da ficha do ator.
 *
 * @returns {{actors:number, tokens:number, preserved:number, ambiguous:number}}
 */
export async function migrateTokenLinks({ notify = true } = {}) {
  if (!game.user?.isGM || !linkEnabled()) return null;

  // ---- 1. Tokens desvinculados já colocados nas cenas ----
  const byActor = new Map(); // actorId → [{scene, token}]
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token.actorLink) continue;
      if (!token.actorId) continue; // token sem ator vinculado: ignora
      const list = byActor.get(token.actorId) ?? [];
      list.push({ scene, token });
      byActor.set(token.actorId, list);
    }
  }

  let preserved = 0;
  let ambiguous = 0;
  let tokenCount = 0;

  for (const [actorId, entries] of byActor) {
    const baseActor = game.actors?.get(actorId);
    if (!baseActor) continue;

    // Único token do ator: preserva o estado atual dele na ficha.
    if (entries.length === 1) {
      const tokenActor = entries[0].token.actor;
      const res = tokenActor?.system?.resources;
      if (res) {
        const update = {
          "system.resources.hp.value": res.hp?.value ?? 0,
          "system.resources.hp.temp": res.hp?.temp ?? 0,
          "system.resources.mp.value": res.mp?.value ?? 0,
          "system.resources.heroic.value": res.heroic?.value ?? 0,
        };
        const conds = tokenActor?.system?.conditions;
        if (Array.isArray(conds)) update["system.conditions"] = conds;
        try { await baseActor.update(update); preserved++; }
        catch (e) { console.warn("Ligeia | falha ao preservar recursos do token:", e); }
      }
    } else {
      ambiguous += entries.length;
    }

    // Vincula os tokens (por cena, em lote).
    const byScene = new Map();
    for (const { scene, token } of entries) {
      const list = byScene.get(scene) ?? [];
      list.push({ _id: token.id, actorLink: true });
      byScene.set(scene, list);
    }
    for (const [scene, updates] of byScene) {
      try { await scene.updateEmbeddedDocuments("Token", updates); tokenCount += updates.length; }
      catch (e) { console.warn("Ligeia | falha ao vincular tokens da cena:", e); }
    }
  }

  // ---- 2. Protótipos de token dos atores ----
  const actorUpdates = (game.actors ?? [])
    .filter((a) => !a.prototypeToken?.actorLink)
    .map((a) => ({ _id: a.id, "prototypeToken.actorLink": true }));
  if (actorUpdates.length) {
    try { await Actor.updateDocuments(actorUpdates); }
    catch (e) { console.warn("Ligeia | falha ao vincular protótipos:", e); }
  }

  const result = {
    actors: actorUpdates.length,
    tokens: tokenCount,
    preserved,
    ambiguous,
  };

  if (notify && (result.actors || result.tokens)) {
    const partes = [];
    if (result.actors) partes.push(`${result.actors} ficha(s)`);
    if (result.tokens) partes.push(`${result.tokens} token(s)`);
    ui.notifications?.info(
      `Ligéia: ${partes.join(" e ")} agora com token e ficha sincronizados` +
        (result.preserved ? ` (${result.preserved} com os valores do token preservados)` : "") +
        ".",
    );
    if (result.ambiguous) {
      ui.notifications?.warn(
        `Ligéia: ${result.ambiguous} token(s) dividiam o mesmo ator e passaram a usar os valores da ficha — confira os PV deles.`,
      );
    }
  }
  return result;
}

/* ==================================================================== */
/*  TAMANHO DO TOKEN conforme a categoria de tamanho do personagem      */
/*  Médio ou menor 1x1 · Grande 2x2 · Enorme 3x3 · Imenso 4x4 ·         */
/*  Colossal 7x7 · Continental 10x10                                    */
/* ==================================================================== */

/** Quantos quadrados do grid o token deste ator deve ocupar (N x N). */
export function tokenSizeFor(actor) {
  const key = actor?.system?.size?.key;
  const def = CONFIG.LIGEIA?.sizes?.[key];
  return Math.max(1, Number(actor?.system?.size?.token ?? def?.token) || 1);
}

/** Quem ajusta os tokens: o GM responsável; sem GM, o dono do ator. */
function shouldResize(actor) {
  const gms = game.users?.filter((u) => u.isGM && u.active) || [];
  if (gms.length) {
    const responsible = gms.sort((a, b) => a.id.localeCompare(b.id))[0];
    return responsible?.id === game.user.id;
  }
  return !!actor?.isOwner;
}

/**
 * Ajusta o protótipo e os tokens colocados para o tamanho atual do ator.
 * Só escreve quando o valor muda, então chamar de novo não faz nada (e não
 * entra em laço com o próprio hook de atualização).
 */
export async function syncTokenSize(actor) {
  if (!actor?.id || actor.documentName !== "Actor") return;
  if (!shouldResize(actor)) return;
  const n = tokenSizeFor(actor);

  // Protótipo (vale para os próximos tokens colocados)
  const pt = actor.prototypeToken;
  if (pt && ((pt.width ?? 1) !== n || (pt.height ?? 1) !== n)) {
    try { await actor.update({ "prototypeToken.width": n, "prototypeToken.height": n }); }
    catch (e) { console.warn("Ligeia | falha ao ajustar o protótipo do token:", e); }
  }

  // Tokens já colocados nas cenas
  for (const scene of game.scenes ?? []) {
    const updates = [];
    for (const token of scene.tokens ?? []) {
      if (token.actorId !== actor.id) continue;
      if ((token.width ?? 1) === n && (token.height ?? 1) === n) continue;
      updates.push({ _id: token.id, width: n, height: n });
    }
    if (updates.length) {
      try { await scene.updateEmbeddedDocuments("Token", updates); }
      catch (e) { console.warn("Ligeia | falha ao ajustar tokens da cena:", e); }
    }
  }
}

/**
 * Hooks que mantêm o tamanho do token em dia. A categoria muda por raça
 * (item), por efeitos de itens ligados/desligados e por efeitos aplicados na
 * ficha — todos passam por uma destas atualizações.
 */
export function registerTokenSizeHooks() {
  const doSync = (actor) => { if (actor?.documentName === "Actor") syncTokenSize(actor); };

  Hooks.on("updateActor", (actor) => doSync(actor));
  Hooks.on("createItem", (item) => doSync(item.parent));
  Hooks.on("updateItem", (item) => doSync(item.parent));
  Hooks.on("deleteItem", (item) => doSync(item.parent));

  // Token novo já nasce com o tamanho certo (mesmo antes de qualquer sync).
  Hooks.on("preCreateToken", (token, data) => {
    const actor = game.actors?.get(data?.actorId ?? token.actorId);
    if (!actor) return;
    const n = tokenSizeFor(actor);
    if (n !== 1 && ((token.width ?? 1) !== n || (token.height ?? 1) !== n)) {
      token.updateSource({ width: n, height: n });
    }
  });
}
