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
  // Nível só se aplica a habilidades e complicações
  if (item.type === "habilidade" || item.type === "complicacao") {
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

/* ======================================================================== */
/*  Agregação e aplicação de modificadores                                  */
/* ======================================================================== */

// Atributos primários e secundários reconhecidos como alvo de efeitos.
const PRIMARY_ATTRS = ["forca", "agilidade", "vigor", "mente", "percepcao"];
const SECONDARY_ATTRS = ["bloqueio", "esquiva", "conjuracao", "iniciativa"];
// Alvos de rolagem que não são um atributo específico.
const ROLL_CATEGORIES = ["all", "attack", "defense"];
// Recursos/derivados que aceitam +N via efeito "stat".
const STAT_TARGETS = ["hp", "mp", "heroic", "deslocamento"];

/**
 * Estrutura zerada de modificadores.
 */
function emptyMods() {
  const attr = {};
  for (const k of [...PRIMARY_ATTRS, ...SECONDARY_ATTRS]) attr[k] = { bonus: 0, dice: 0, set: null, reroll1: 0, reroll6: 0, critBonus: 0, failBonus: 0 };
  const roll = {};
  for (const k of ROLL_CATEGORIES) roll[k] = { bonus: 0, dice: 0, reroll1: 0, reroll6: 0, critBonus: 0, failBonus: 0 };
  const stat = {};
  for (const k of STAT_TARGETS) stat[k] = 0;
  return { attr, roll, stat };
}

/**
 * Combina dois valores de reroll (cada um número ≥0 ou "all"/Infinity).
 * "all" sempre vence; senão soma as contagens.
 */
function combineReroll(a, b) {
  const aAll = a === "all" || a === Infinity;
  const bAll = b === "all" || b === Infinity;
  if (aAll || bAll) return Infinity;
  return (Number(a) || 0) + (Number(b) || 0);
}

/**
 * Aplica um único efeito (já ativo) à estrutura de modificadores.
 *  - bonus: +valor ao destino (atributo, categoria de rolagem). NEGATIVO reduz.
 *  - dice:  +valor de dados de melhoria ao destino. NEGATIVO reduz/dá desvantagem.
 *  - stat:  +valor a um recurso/derivado (hp/mp/heroic/deslocamento). NEGATIVO reduz.
 *  - set:   define (sobrescreve) o valor de um atributo.
 *  - reroll1: rerrola dados que caem 1 (valor = quantos, ou "all").
 *  - reroll6: rerrola dados que caem 6 (valor = quantos, ou "all").
 */
function applyEffectToMods(mods, effect) {
  const t = effect.target || "all";
  const v = Number(effect.value) || 0;

  if (effect.type === "bonus") {
    if (mods.attr[t]) mods.attr[t].bonus += v;
    else if (mods.roll[t]) mods.roll[t].bonus += v;
  } else if (effect.type === "dice") {
    if (mods.attr[t]) mods.attr[t].dice += v;
    else if (mods.roll[t]) mods.roll[t].dice += v;
  } else if (effect.type === "stat") {
    if (t in mods.stat) mods.stat[t] += v;
  } else if (effect.type === "set") {
    if (mods.attr[t]) mods.attr[t].set = v; // último a definir vence
  } else if (effect.type === "reroll1") {
    const val = effect.rerollAll ? "all" : (Number(effect.value) || 0);
    if (mods.attr[t]) mods.attr[t].reroll1 = combineReroll(mods.attr[t].reroll1, val);
    else if (mods.roll[t]) mods.roll[t].reroll1 = combineReroll(mods.roll[t].reroll1, val);
  } else if (effect.type === "reroll6") {
    const val = effect.rerollAll ? "all" : (Number(effect.value) || 0);
    if (mods.attr[t]) mods.attr[t].reroll6 = combineReroll(mods.attr[t].reroll6, val);
    else if (mods.roll[t]) mods.roll[t].reroll6 = combineReroll(mods.roll[t].reroll6, val);
  } else if (effect.type === "crit") {
    // Crítico aprimorado: reduz o limiar de dados para crítico.
    if (mods.attr[t]) mods.attr[t].critBonus += v;
    else if (mods.roll[t]) mods.roll[t].critBonus += v;
  } else if (effect.type === "fumble") {
    // Falha piorada: aumenta o limiar de dados para falha crítica.
    if (mods.attr[t]) mods.attr[t].failBonus += v;
    else if (mods.roll[t]) mods.roll[t].failBonus += v;
  }
  // "damage", "rd", "condition", "info" são tratados em outros lugares
}

/**
 * Agrega todos os modificadores ativos de um ator (itens + efeitos aplicados
 * diretamente na ficha) numa estrutura somada por destino.
 * @returns {{attr, roll, stat}}
 */
export function aggregateEffectModifiers(actor) {
  const mods = emptyMods();

  // Efeitos vindos dos itens
  for (const { effect } of collectActorEffects(actor)) {
    applyEffectToMods(mods, effect);
  }

  // Efeitos aplicados diretamente na ficha (buffs/debuffs com duração)
  for (const ae of actor.system?.appliedEffects || []) {
    if (ae.disabled) continue;
    for (const effect of ae.effects || []) {
      if (effect.enabled === false) continue;
      applyEffectToMods(mods, effect);
    }
  }

  return mods;
}
