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
/*  Variáveis (@) e resolução de valores com fórmula                        */
/* ======================================================================== */

/**
 * Dados de rolagem (@variáveis) de um ator, para fórmulas de dano, cura,
 * alcance, área e valores de efeito — ex.: "1d6+@forca", "floor(@nivel/2)".
 * Chaves sem acento (a sintaxe @ do Foundry só aceita ASCII). Vale para
 * personagens e NPCs (mesma ficha).
 */
export function actorRollData(actor) {
  const sys = actor?.system || {};
  const attrs = sys.attributes || {};
  const sec = sys.secondary || {};
  const res = sys.resources || {};
  const num = (v) => Number(v) || 0;
  return {
    // Atributos
    forca: num(attrs.forca?.value),
    agilidade: num(attrs.agilidade?.value),
    vigor: num(attrs.vigor?.value),
    mente: num(attrs.mente?.value),
    percepcao: num(attrs.percepcao?.value),
    // Secundários (derivados)
    bloqueio: num(sec.bloqueio),
    esquiva: num(sec.esquiva),
    conjuracao: num(sec.conjuracao),
    iniciativa: num(sec.iniciativa),
    deslocamento: num(sec.deslocamento),
    // Progressão
    nivel: num(sys.details?.level) || 1,
    // Recursos (atual e máximo) + sobrevida
    pv: num(res.hp?.value), pvmax: num(res.hp?.max),
    pm: num(res.mp?.value), pmmax: num(res.mp?.max),
    ph: num(res.heroic?.value), phmax: num(res.heroic?.max),
    sobrevida: num(res.hp?.temp),
  };
}

/**
 * Resolve um VALOR que pode ser número ou fórmula DETERMINÍSTICA do Foundry
 * com @variáveis do ator — ex.: "floor(@nivel/2)", "@forca+1". Dados (1d6)
 * NÃO valem aqui; fórmulas inválidas e variáveis desconhecidas resolvem 0.
 *
 * Atenção: valores de efeitos de ITEM são agregados durante o
 * prepareDerivedData, ANTES dos secundários serem recalculados — nessas
 * fórmulas, @bloqueio/@esquiva/@conjuracao/@iniciativa/@deslocamento podem
 * valer 0 (ou o valor do preparo anterior). Prefira atributos e @nivel.
 */
export function resolveEffectValue(raw, actor) {
  if (raw === null || raw === undefined || raw === "") return 0;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  try {
    const R = globalThis.Roll;
    const expr = R.replaceFormulaData(String(raw), actorRollData(actor), { missing: "0", warn: false });
    const v = R.safeEval(expr);
    return Number.isFinite(v) ? v : 0;
  } catch (e) {
    return 0;
  }
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
function applyEffectToMods(mods, effect, actor) {
  const t = effect.target || "all";
  // Valor: número ou fórmula com as @variáveis do dono do efeito.
  const v = resolveEffectValue(effect.value, actor);

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
    const val = effect.rerollAll ? "all" : v;
    if (mods.attr[t]) mods.attr[t].reroll1 = combineReroll(mods.attr[t].reroll1, val);
    else if (mods.roll[t]) mods.roll[t].reroll1 = combineReroll(mods.roll[t].reroll1, val);
  } else if (effect.type === "reroll6") {
    const val = effect.rerollAll ? "all" : v;
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
    applyEffectToMods(mods, effect, actor);
  }

  // Efeitos aplicados diretamente na ficha (buffs/debuffs com duração)
  for (const ae of actor.system?.appliedEffects || []) {
    if (ae.disabled) continue;
    for (const effect of ae.effects || []) {
      if (effect.enabled === false) continue;
      applyEffectToMods(mods, effect, actor);
    }
  }

  return mods;
}

/** Alvos válidos do efeito "areaFilter" (filtro de área forçado). */
const AREA_FILTER_TARGETS = ["allies", "enemies"];

/**
 * Override do filtro de área: se o ator tiver QUALQUER efeito ativo do tipo
 * "areaFilter" — em itens ligados (respeitando nível B/A/E) ou em efeitos
 * aplicados não desligados — TODAS as ações de área/aura dele passam a
 * afetar só aliados ou só inimigos, sobrepondo o filtro configurado em cada
 * ação. Havendo mais de um ativo, vale o PRIMEIRO encontrado (itens na ordem
 * da ficha primeiro, depois efeitos aplicados).
 *
 * @param {Actor} actor
 * @returns {"allies"|"enemies"|null}
 */
export function areaFilterOverrideFor(actor) {
  for (const item of actor?.items || []) {
    for (const e of activeEffectsOf(item)) {
      if (e.type === "areaFilter" && AREA_FILTER_TARGETS.includes(e.target)) return e.target;
    }
  }
  for (const ae of actor?.system?.appliedEffects || []) {
    if (ae?.disabled) continue;
    for (const e of ae.effects || []) {
      if (e?.enabled === false) continue;
      if (e?.type === "areaFilter" && AREA_FILTER_TARGETS.includes(e.target)) return e.target;
    }
  }
  return null;
}
