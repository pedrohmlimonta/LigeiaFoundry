/**
 * Lógica de efeitos do Ligeia.
 *
 * Um efeito de item está "ativo" (contribuindo) quando:
 *  - o item é passivo OU está ligado (system.active);
 *  - o efeito individual está habilitado (effect.enabled);
 *  - para HABILIDADES, o nível adquirido (system.level) alcança o nível
 *    exigido pelo efeito (effect.level): "all" sempre vale; "B" vale em
 *    B/A/E; "A" vale em A/E; "E" vale só em E.
 */

const LEVEL_ORDER = { B: 1, A: 2, E: 3 };

/**
 * O nível adquirido alcança o nível exigido pelo efeito?
 * @param {string} acquired  "B" | "A" | "E"
 * @param {string} required  "all" | "B" | "A" | "E"
 */
export function levelMeets(acquired, required) {
  if (!required || required === "all") return true;
  const a = LEVEL_ORDER[acquired] || 0;
  const r = LEVEL_ORDER[required] || 0;
  return a >= r;
}

/**
 * O item está "ligado" (passivo sempre conta; ativo precisa de active=true)?
 */
export function itemIsOn(item) {
  const mode = item?.system?.mode;
  if (mode === "active") return !!item.system.active;
  return true; // passivo
}

/**
 * Um efeito específico está contribuindo agora?
 * @param {Item} item
 * @param {object} effect  entrada de system.effects
 */
export function effectIsActive(item, effect) {
  if (!effect || effect.enabled === false) return false;
  if (!itemIsOn(item)) return false;
  // Nível só se aplica a habilidades
  if (item.type === "habilidade") {
    return levelMeets(item.system?.level || "B", effect.level || "all");
  }
  return true;
}

/**
 * Retorna os efeitos ativos de um item (já filtrados por enabled, modo e
 * nível). Útil para somar modificadores.
 * @param {Item} item
 * @returns {Array} efeitos ativos
 */
export function activeEffectsOf(item) {
  const list = item?.system?.effects || [];
  return list.filter((e) => effectIsActive(item, e));
}

/**
 * Coleta todos os efeitos ativos de um ator, de todos os itens.
 * @param {Actor} actor
 * @returns {Array<{item, effect}>}
 */
export function collectActorEffects(actor) {
  const out = [];
  for (const item of actor.items) {
    for (const effect of activeEffectsOf(item)) {
      out.push({ item, effect });
    }
  }
  return out;
}
