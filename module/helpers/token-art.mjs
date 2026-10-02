/**
 * ARTE DO TOKEN POR FERIMENTO
 * ===========================================================================
 * Troca a imagem do token conforme os Pontos de Vida que restam, para que o
 * estado do personagem apareça no mapa sem ninguém precisar abrir a ficha.
 *
 * FAIXAS (a porcentagem vai do máximo até zero; PV negativos NÃO entram na
 * conta — abaixo de zero já se usa a arte de "caído"):
 *
 *   ≥ 75% ............ padrão
 *   < 75% ............ ferido
 *   < 50% ............ muito ferido
 *   < 25% ............ quase morrendo
 *   ≤ 0 PV ........... caído
 *   ≤ DEATH_HP (−7) .. morto
 *
 * CASCATA: uma faixa sem imagem cai para a faixa ACIMA (menos ferida), e
 * assim por diante até o padrão, que é sempre o último recurso. Ou seja, com
 * apenas a arte de 25% preenchida, o personagem usa o padrão até cair abaixo
 * de 25%; com 75% e 25% preenchidas e 50% vazia, a de 75% cobre toda a faixa
 * dos 75% aos 25%.
 *
 * QUEM APLICA: a troca mexe no token da cena, então é feita por um único
 * cliente — o Narrador principal (`game.users.activeGM`). Sem Narrador
 * conectado, o dono do ator aplica se tiver permissão sobre o token. Isso
 * evita que vários clientes escrevam o mesmo update ao mesmo tempo.
 */

import { DEATH_HP } from "./wounds.mjs";

/** Tipos de ator que usam esta mecânica. */
const ACTOR_TYPES = ["personagem", "npc", "veiculo"];

/**
 * As faixas, da MENOS ferida para a MAIS ferida. A ordem é o que define a
 * cascata: ao faltar a imagem de uma faixa, procura-se para trás nesta lista.
 * `min` é o piso da porcentagem (inclusivo) que ativa a faixa.
 */
export const ART_TIERS = [
  { key: "default", label: "Padrão (75% ou mais)", min: 75 },
  { key: "p75", label: "Ferido (abaixo de 75%)", min: 50 },
  { key: "p50", label: "Muito ferido (abaixo de 50%)", min: 25 },
  // Qualquer PV acima de zero que não chegue a 25%: zero ou menos já é "caído".
  { key: "p25", label: "Quase morrendo (abaixo de 25%)", min: 0 },
  // Estas duas não são decididas por porcentagem, e sim pelos PV absolutos.
  { key: "down", label: "Caído (0 PV ou menos)", min: -Infinity },
  { key: "dead", label: "Morto (" + DEATH_HP + " PV)", min: -Infinity },
];

/** Índice da faixa "morto" (tratada à parte, por PV absoluto). */
const DEAD_INDEX = ART_TIERS.length - 1;
/** Índice da faixa "caído". */
const DOWN_INDEX = DEAD_INDEX - 1;

/**
 * Porcentagem de vida usada pelas faixas: do máximo até zero, sem considerar
 * PV negativos (que já caem em "caído"/"morto").
 * @param {Actor} actor
 * @returns {number} 0 a 100
 */
export function healthPercent(actor) {
  const hp = actor?.system?.resources?.hp || {};
  const max = Number(hp.max) || 0;
  const value = Number(hp.value) || 0;
  if (max <= 0) return 100; // sem máximo definido, trata como inteiro
  if (value <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/**
 * Qual faixa este ator ocupa agora (índice em ART_TIERS).
 * @param {Actor} actor
 * @returns {number}
 */
export function tierIndexFor(actor) {
  const hp = actor?.system?.resources?.hp || {};
  const value = Number(hp.value) || 0;
  if (value <= DEATH_HP) return DEAD_INDEX;
  if (value <= 0) return DOWN_INDEX;
  const pct = healthPercent(actor);
  // Percorre da faixa MENOS ferida para a mais ferida e para na primeira cujo
  // piso o personagem ainda alcança: 80% para em "default", 60% em "p75"…
  for (let i = 0; i < DOWN_INDEX; i++) {
    if (pct >= ART_TIERS[i].min) return i;
  }
  return DOWN_INDEX - 1; // PV > 0 porém abaixo de 25%
}

/**
 * A imagem configurada para uma faixa, ou "" se estiver vazia.
 * A faixa "default" cai para a imagem do token padrão do ator quando o campo
 * não foi preenchido, de modo que a cascata sempre termina em algo válido.
 */
function artFor(actor, index) {
  const art = actor?.system?.tokenArt || {};
  const key = ART_TIERS[index]?.key;
  const src = String(art[key] || "").trim();
  if (src) return src;
  if (index === 0) return String(actor?.prototypeToken?.texture?.src || "").trim();
  return "";
}

/**
 * Imagem de token que este ator deve estar usando agora, já resolvida pela
 * cascata (faixa atual → faixas acima → padrão → token padrão do ator).
 * @param {Actor} actor
 * @returns {string} caminho da imagem, ou "" quando não há nada configurado
 */
export function tokenArtFor(actor) {
  if (!actor || !ACTOR_TYPES.includes(actor.type)) return "";
  const idx = tierIndexFor(actor);
  for (let i = idx; i >= 0; i--) {
    const src = artFor(actor, i);
    if (src) return src;
  }
  return "";
}

/**
 * Linhas da aba "Tokens e Teatro": uma por faixa, já com a imagem que a faixa
 * usaria de verdade e de onde ela vem quando o campo está vazio.
 * @param {Actor} actor
 * @returns {Array<{key, label, value, resolved, inheritedFrom, active}>}
 */
export function artRowsFor(actor) {
  const atual = tierIndexFor(actor);
  const proto = String(actor?.prototypeToken?.texture?.src || "").trim();
  const rows = [];
  for (let i = 0; i < ART_TIERS.length; i++) {
    const t = ART_TIERS[i];
    const value = String(actor?.system?.tokenArt?.[t.key] || "").trim();
    let resolved = value;
    let inheritedFrom = "";
    if (!resolved) {
      for (let j = i - 1; j >= 0; j--) {
        const v = artFor(actor, j);
        if (v) {
          resolved = v;
          // Se a faixa de origem também estava vazia, o que ela devolveu já é
          // o token padrão do ator.
          inheritedFrom = String(actor?.system?.tokenArt?.[ART_TIERS[j].key] || "").trim()
            ? ART_TIERS[j].label
            : "token padrão do ator";
          break;
        }
      }
      if (!resolved && proto) { resolved = proto; inheritedFrom = "token padrão do ator"; }
    }
    rows.push({ key: t.key, label: t.label, value, resolved, inheritedFrom, active: i === atual });
  }
  return rows;
}

/** Este ator tem alguma arte por ferimento configurada? */
export function hasWoundArt(actor) {
  const art = actor?.system?.tokenArt || {};
  return ART_TIERS.some((t) => t.key !== "default" && String(art[t.key] || "").trim());
}

/* ======================================================================== */
/*  Aplicação nos tokens da cena                                            */
/* ======================================================================== */

/**
 * Este cliente é o responsável por aplicar a troca neste ator?
 * Narrador principal sempre; sem Narrador conectado, o dono do ator.
 */
function shouldApply(actor) {
  const activeGM = game.users?.activeGM;
  if (activeGM) return activeGM.isSelf === true || activeGM.id === game.user?.id;
  return !!actor?.isOwner;
}

/**
 * Atualiza a textura dos tokens deste ator na cena atual, se a faixa pedir
 * uma imagem diferente da que o token está usando.
 * @param {Actor} actor
 */
export async function syncTokenArt(actor) {
  if (!actor || !ACTOR_TYPES.includes(actor.type)) return;
  // Sem nenhuma arte de ferimento configurada, não mexe em nada: assim quem
  // não usa a mecânica nunca tem o token alterado pelo sistema.
  if (!hasWoundArt(actor)) return;
  if (!shouldApply(actor)) return;

  const src = tokenArtFor(actor);
  if (!src) return;

  const updates = [];
  for (const t of canvas?.tokens?.placeables || []) {
    const sameActor = t.actor?.id === actor.id || t.document?.actorId === actor.id;
    if (!sameActor) continue;
    if (t.document.texture?.src === src) continue;
    updates.push({ _id: t.document.id, "texture.src": src });
  }
  if (!updates.length) return;
  try {
    await canvas.scene.updateEmbeddedDocuments("Token", updates);
  } catch (e) {
    console.warn("Ligeia RPG | não foi possível trocar a arte do token:", e);
  }
}

/**
 * Aplica a arte certa a um token recém-criado/desenhado (um token colocado
 * num ator já ferido deve nascer com a arte correta).
 * @param {TokenDocument} tokenDoc
 */
export async function syncTokenArtFor(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor || !ACTOR_TYPES.includes(actor.type)) return;
  if (!hasWoundArt(actor)) return;
  if (!shouldApply(actor)) return;
  const src = tokenArtFor(actor);
  if (!src || tokenDoc.texture?.src === src) return;
  try {
    await tokenDoc.update({ "texture.src": src });
  } catch (e) {
    console.warn("Ligeia RPG | não foi possível trocar a arte do token:", e);
  }
}

/** Reaplica a arte em todos os tokens da cena (ex.: ao carregar a cena). */
export async function syncAllTokenArt() {
  const vistos = new Set();
  for (const t of canvas?.tokens?.placeables || []) {
    const a = t.actor;
    if (!a || vistos.has(a.id)) continue;
    vistos.add(a.id);
    await syncTokenArt(a);
  }
}

/* ======================================================================== */
/*  Hooks                                                                   */
/* ======================================================================== */

/** Liga a troca de arte às mudanças de PV e à criação de tokens. */
export function registerTokenArtHooks() {
  // PV mudou (dano, cura, descanso) ou as imagens foram reconfiguradas.
  Hooks.on("updateActor", (actor, changes) => {
    const sys = changes?.system;
    if (!sys) return;
    const mexeuNosPv = sys.resources?.hp !== undefined;
    if (!mexeuNosPv && sys.tokenArt === undefined) return;
    syncTokenArt(actor);
  });

  // Token colocado na cena: já nasce com a arte da faixa atual.
  Hooks.on("createToken", (tokenDoc) => syncTokenArtFor(tokenDoc));

  // Cena carregada: acerta o que tiver ficado para trás (dano aplicado com a
  // cena fechada, por exemplo).
  Hooks.on("canvasReady", () => syncAllTokenArt());
}
