/**
 * RETRATO DO THEATRE POR FERIMENTO
 * ===========================================================================
 * Integração opcional com o módulo "Theatre Inserts" (id `theatre`):
 * o retrato que aparece no palco muda junto com os Pontos de Vida, usando
 * exatamente as mesmas faixas e a mesma cascata da arte do token
 * (ver helpers/token-art.mjs).
 *
 * COMO O THEATRE GUARDA O RETRATO
 *   `actor.flags.theatre.baseinsert` — a imagem base do insert. É de lá que o
 *   módulo lê ao colocar o personagem no palco, e é o que escrevemos.
 *   Sem ela, o Theatre usa o retrato da ficha (`actor.img`).
 *
 * PRESERVAR O RETRATO ORIGINAL
 *   Como passamos a escrever em `baseinsert`, o retrato que o mestre havia
 *   configurado pelo próprio Theatre seria perdido na primeira troca. Por isso
 *   ele é COPIADO para o campo "Padrão" da ficha antes da primeira
 *   sobrescrita (ver `capturarRetratoOriginal`), e volta a valer sempre que o
 *   personagem estiver com 75% de vida ou mais.
 *
 * TROCA AO VIVO
 *   Mudar a flag basta para o próximo insert; um insert JÁ no palco precisa
 *   ter a textura trocada no PIXI. Isso usa métodos internos do Theatre
 *   (`_AddAllTextureResources`, `_clearPortraitContainer`,
 *   `_setupPortraitContainer`), então vai todo dentro de try/catch: se uma
 *   versão futura mudar esses nomes, a flag continua correta e o retrato certo
 *   aparece na próxima vez que o personagem subir ao palco.
 *   `_AddAllTextureResources(..., remote=false)` já avisa os outros clientes,
 *   então basta um cliente fazer a troca.
 */

import { ART_TIERS, tierIndexFor, resolveTierSrc, buildArtRows } from "./token-art.mjs";

/** Id do módulo Theatre Inserts no Foundry. */
export const THEATRE_MODULE = "theatre";
/** Prefixo que o Theatre usa nos ids de insert. */
const INSERT_PREFIX = "theatre-";

/** Tipos de ator que usam esta mecânica. */
const ACTOR_TYPES = ["personagem", "npc", "veiculo"];

/**
 * O módulo Theatre está instalado E ativo neste mundo?
 * Enquanto for falso, a seção de teatro nem aparece na ficha e nada é escrito
 * nas flags.
 * @returns {boolean}
 */
export function theatreActive() {
  try {
    return !!game.modules?.get(THEATRE_MODULE)?.active;
  } catch (e) {
    return false;
  }
}

/** Imagem de último recurso do retrato: o retrato da ficha do ator. */
function retratoBase(actor) {
  return String(actor?.img || "").trim();
}

/**
 * Retrato de teatro que este ator deve estar usando agora, já resolvido pela
 * cascata (faixa atual → faixas acima → padrão → retrato da ficha).
 * @param {Actor} actor
 * @returns {string}
 */
export function theatreArtFor(actor) {
  if (!actor || !ACTOR_TYPES.includes(actor.type)) return "";
  return resolveTierSrc(actor.system?.theatreArt, tierIndexFor(actor), retratoBase(actor));
}

/** Linhas da grade de retratos na aba "Tokens e Teatro". */
export function theatreRowsFor(actor) {
  return buildArtRows(
    actor?.system?.theatreArt,
    tierIndexFor(actor),
    retratoBase(actor),
    "retrato da ficha",
  );
}

/** Este ator tem algum retrato de ferimento configurado? */
export function hasTheatreArt(actor) {
  const art = actor?.system?.theatreArt || {};
  return ART_TIERS.some((t) => t.key !== "default" && String(art[t.key] || "").trim());
}

/* ======================================================================== */
/*  Aplicação                                                               */
/* ======================================================================== */

/**
 * Este cliente é o responsável por aplicar a troca? Narrador principal
 * sempre; sem Narrador conectado, o dono do ator.
 */
function shouldApply(actor) {
  const activeGM = game.users?.activeGM;
  if (activeGM) return activeGM.isSelf === true || activeGM.id === game.user?.id;
  return !!actor?.isOwner;
}

/**
 * Antes da primeira sobrescrita, guarda no campo "Padrão" o retrato que o
 * mestre já tinha configurado pelo Theatre, para que ele não se perca.
 * @returns {Promise<boolean>} true se guardou algo agora
 */
async function capturarRetratoOriginal(actor) {
  const jaTem = String(actor.system?.theatreArt?.default || "").trim();
  if (jaTem) return false;
  const atual = String(actor.flags?.theatre?.baseinsert || "").trim();
  if (!atual) return false;
  await actor.update({ "system.theatreArt.default": atual });
  return true;
}

/**
 * Troca a textura de um insert que já está no palco. Todo o acesso ao módulo
 * fica aqui dentro, protegido: falhar aqui não impede a flag de ficar certa.
 * @param {Actor} actor
 * @param {string} src
 */
async function trocarInsertNoPalco(actor, src) {
  try {
    const T = globalThis.Theatre;
    const inst = T?.instance;
    if (!inst) return;
    const theatreId = `${INSERT_PREFIX}${actor.id}`;
    const insert = inst.getInsertById?.(theatreId);

    // A miniatura da barra de navegação do Theatre, se o personagem estiver lá.
    try {
      const navItem = inst.getNavItemById?.(theatreId);
      if (navItem) navItem.setAttribute("src", src);
    } catch (e) { /* barra de navegação opcional */ }

    if (!insert || !insert.dockContainer) return; // não está no palco

    const emote = inst._getEmoteFromInsert?.(insert) ?? null;
    // remote=false → o próprio Theatre avisa os outros clientes.
    const resources = await inst._AddAllTextureResources(
      [{ imgpath: src, resname: src }], theatreId, emote, src, false,
    );
    inst._clearPortraitContainer(theatreId);
    await inst._setupPortraitContainer(theatreId, insert.optAlign, src, resources);
    // Reencaixa o nome e o balãozinho de digitação, que o clear removeu.
    insert.dockContainer.addChild(insert.label);
    insert.dockContainer.addChild(insert.typingBubble);
    inst._repositionInsertElements(insert);
    if (!inst.rendering) inst._renderTheatre(performance.now());
  } catch (e) {
    console.warn("Ligeia RPG | não foi possível trocar o retrato no palco do Theatre:", e);
  }
}

/**
 * Atores sendo sincronizados agora. Guardar o retrato original é um update de
 * `system`, que volta pelo hook `updateActor`; esta trava evita a segunda
 * passada inútil.
 */
const emAndamento = new Set();

/**
 * Põe o retrato da faixa atual na flag do Theatre (e no palco, se o
 * personagem estiver nele).
 * @param {Actor} actor
 */
export async function syncTheatreArt(actor) {
  if (!theatreActive()) return;
  if (!actor || !ACTOR_TYPES.includes(actor.type)) return;
  // Quem não configurou nenhum retrato de ferimento nunca tem a flag mexida.
  if (!hasTheatreArt(actor)) return;
  if (!shouldApply(actor)) return;
  if (emAndamento.has(actor.id)) return;

  emAndamento.add(actor.id);
  try {
    await capturarRetratoOriginal(actor);

    const src = theatreArtFor(actor);
    if (!src) return;
    if (String(actor.flags?.theatre?.baseinsert || "") === src) return;

    try {
      await actor.update({ "flags.theatre.baseinsert": src });
    } catch (e) {
      console.warn("Ligeia RPG | não foi possível gravar o retrato do Theatre:", e);
      return;
    }
    await trocarInsertNoPalco(actor, src);
  } finally {
    emAndamento.delete(actor.id);
  }
}

/** Reaplica o retrato de todos os atores com tokens na cena. */
export async function syncAllTheatreArt() {
  if (!theatreActive()) return;
  const vistos = new Set();
  for (const t of canvas?.tokens?.placeables || []) {
    const a = t.actor;
    if (!a || vistos.has(a.id)) continue;
    vistos.add(a.id);
    await syncTheatreArt(a);
  }
}

/* ======================================================================== */
/*  Hooks                                                                   */
/* ======================================================================== */

/** Liga o retrato do Theatre às mudanças de PV. */
export function registerTheatreArtHooks() {
  Hooks.on("updateActor", (actor, changes) => {
    const sys = changes?.system;
    if (!sys) return;
    const mexeuNosPv = sys.resources?.hp !== undefined;
    if (!mexeuNosPv && sys.theatreArt === undefined) return;
    syncTheatreArt(actor);
  });

  // Cena carregada: acerta quem tiver ficado para trás.
  Hooks.on("canvasReady", () => syncAllTheatreArt());
}
