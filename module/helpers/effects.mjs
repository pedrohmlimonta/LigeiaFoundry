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
    // Usa o TOTAL (base + bônus de atributo); cai na base se ainda não
    // houver derivado calculado.
    forca: num(attrs.forca?.total ?? attrs.forca?.value),
    agilidade: num(attrs.agilidade?.total ?? attrs.agilidade?.value),
    vigor: num(attrs.vigor?.total ?? attrs.vigor?.value),
    mente: num(attrs.mente?.total ?? attrs.mente?.value),
    percepcao: num(attrs.percepcao?.total ?? attrs.percepcao?.value),
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
/*  Palavras arcanas                                                        */
/* ======================================================================== */

/** Quantas palavras arcanas cada círculo de magia comporta. */
export const WORDS_BY_TIER = { "Menor": 1, "Intermediária": 2, "Maior": 3 };

/** Prefixo dos alvos de efeito que valem só para uma palavra arcana. */
export const WORD_TARGET_PREFIX = "conjuracao:";

/**
 * Palavras arcanas VÁLIDAS de uma magia: as preenchidas, até o limite do
 * círculo (Menor 1, Intermediária 2, Maior 3). Baixar o círculo deixa de
 * contar as palavras excedentes, em vez de manter um bônus invisível.
 *
 * REPETIÇÕES CONTAM: uma magia com "ácida, ácida" usa a palavra duas vezes,
 * então um bônus de +1 em conjurações de ácida rende +2. Por isso a lista
 * sai com as repetições, e não como um conjunto.
 *
 * @param {Item} item
 * @returns {string[]} pode conter a mesma palavra mais de uma vez
 */
export function arcaneWordsOf(item) {
  if (item?.type !== "magia") return [];
  const sys = item.system || {};
  const limite = WORDS_BY_TIER[sys.tier] ?? 1;
  const todas = [sys.wordId, sys.wordId2, sys.wordId3];
  const out = [];
  for (let i = 0; i < limite; i++) {
    const w = String(todas[i] || "").trim();
    if (w) out.push(w);
  }
  return out;
}

/* ======================================================================== */
/*  Tipagens de arma                                                        */
/* ======================================================================== */

/** Prefixo dos alvos de efeito que valem só para UMA tipagem de arma. */
export const WEAPON_TAG_PREFIX = "arma:";

/** Alvo que vale para QUALQUER arma tipada (a contraparte de "conjuracao"). */
export const WEAPON_ANY_TARGET = "arma";

/**
 * Normaliza um nome de tipagem para virar id: minúsculas, sem acento, com
 * underscore no lugar dos espaços. É o que permite ao campo livre
 * ("outras tipagens") casar com um efeito mirado na mesma tipagem.
 * @param {string} nome
 * @returns {string}
 */
export function weaponTagId(nome) {
  return String(nome || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * TIPAGENS de um item, como ids.
 *
 * Diferente das palavras arcanas, não há teto: uma arma pode ter quantas
 * tipagens quiser. Junta as marcadas na lista do livro com as digitadas no
 * campo livre, sem repetir — uma tipagem marcada duas vezes é a mesma
 * tipagem, então não acumula (ao contrário das palavras arcanas, em que a
 * repetição é deliberada e conta de novo).
 *
 * @param {Item} item
 * @returns {string[]} ids únicos
 */
export function weaponTagsOf(item) {
  const sys = item?.system || {};
  const marcadas = Array.isArray(sys.tags) ? sys.tags : [];
  const livres = String(sys.tagsExtra || "").split(",");
  const out = [];
  for (const t of [...marcadas, ...livres]) {
    const id = weaponTagId(t);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Rótulo de exibição de uma tipagem: o do livro quando existe, senão o
 * próprio id reconstruído em palavras.
 * @param {string} id
 * @returns {string}
 */
export function weaponTagLabel(id) {
  const doLivro = CONFIG?.LIGEIA?.weaponTags?.[id];
  if (doLivro) return doLivro;
  return String(id || "").split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

/**
 * Tipagens de arma como ALVOS de efeito, para os seletores das fichas.
 *
 * Além das tipagens do livro, inclui as que o mundo já usa em alguma arma
 * (campo "outras tipagens"), senão não haveria como mirar uma tipagem
 * inventada. O alvo "arma" puro vale para qualquer arma tipada.
 *
 * Mora aqui, e não numa ficha, porque os três lugares de efeito do sistema
 * (item, ação e efeito ativo) precisam da mesma lista.
 *
 * @returns {Record<string,string>} alvo → rótulo
 */
export function tipagensComoAlvos() {
  const out = { [WEAPON_ANY_TARGET]: "Arma (qualquer tipagem)" };
  const ids = Object.keys(CONFIG?.LIGEIA?.weaponTags || {});
  const extras = new Set();
  const varrer = (itens) => {
    for (const it of itens || []) {
      for (const t of String(it?.system?.tagsExtra || "").split(",")) {
        const id = weaponTagId(t);
        if (id && !ids.includes(id)) extras.add(id);
      }
    }
  };
  try {
    varrer(globalThis.game?.items);
    for (const a of globalThis.game?.actors || []) varrer(a.items);
  } catch (e) { /* fora de um mundo carregado: só a lista do livro */ }
  for (const id of [...ids, ...[...extras].sort()]) {
    out[`${WEAPON_TAG_PREFIX}${id}`] = `Arma — ${weaponTagLabel(id)}`;
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
//  - all                : vale para toda e qualquer rolagem
//  - attack / defense   : qualquer ataque / qualquer defesa (como antes)
//  - attackMelee/Ranged : só ataques de ações marcadas (ou não) como
//                         "esta ação é corpo a corpo"
//  - defenseMelee/Ranged: só defesas CONTRA ataques corpo a corpo / à distância
const ROLL_CATEGORIES = [
  "all", "attack", "defense",
  "attackMelee", "attackRanged", "defenseMelee", "defenseRanged",
];
// Recursos/derivados que aceitam +N via efeito "stat".
const STAT_TARGETS = ["hp", "mp", "heroic", "deslocamento"];

/**
 * Estrutura zerada de modificadores.
 */
function emptyMods() {
  const attr = {};
  // bonus     = bônus SÓ NA ROLAGEM daquele atributo (não muda o atributo)
  // attrBonus = bônus no VALOR do atributo (muda a ficha e o que dele deriva)
  // dice     = dados de melhoria NO ATRIBUTO (aparecem na ficha)
  // rollDice = dados que valem SÓ na rolagem (não mexem no atributo)
  for (const k of [...PRIMARY_ATTRS, ...SECONDARY_ATTRS]) attr[k] = { bonus: 0, attrBonus: 0, dice: 0, rollDice: 0, set: null, reroll1: 0, reroll6: 0, critBonus: 0, failBonus: 0 };
  // Tamanho: shift = categorias a mover (soma); set = categoria fixada.
  const size = { shift: 0, set: null };
  const roll = {};
  for (const k of ROLL_CATEGORIES) roll[k] = { bonus: 0, dice: 0, reroll1: 0, reroll6: 0, critBonus: 0, failBonus: 0 };
  const stat = {};
  for (const k of STAT_TARGETS) stat[k] = 0;
  // Bônus de conjuração restritos a uma PALAVRA ARCANA. Preenchido sob
  // demanda: palavra → mesmos campos de uma categoria de rolagem.
  const word = {};
  // Bônus restritos a uma TIPAGEM de arma, no mesmo molde. A chave
  // WEAPON_ANY_TARGET ("arma") guarda o que vale para qualquer arma tipada.
  const weapon = {};
  return { attr, roll, stat, size, word, weapon };
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
 *  - bonus: +valor na ROLAGEM do destino (atributo ou categoria). O valor do
 *           atributo na ficha NÃO muda. NEGATIVO reduz.
 *  - attr:  +valor no ATRIBUTO em si (reflete na ficha, nos secundários
 *           derivados e em tudo que usa o atributo). NEGATIVO reduz.
 *  - dice:  +dados de melhoria no ATRIBUTO (aparecem na ficha).
 *  - rollDice: +dados de melhoria SÓ NA ROLAGEM — não alteram o atributo,
 *           então não mexem em PV/PM nem no que deriva dele.
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

  // Alvo "conjuracao:<palavra>": vale só para magias que tenham aquela
  // palavra arcana. Vive num balde à parte, somado na hora da rolagem
  // (ver dice.mjs), e acumula quando a magia casa com mais de um efeito.
  if (t.startsWith(WORD_TARGET_PREFIX)) {
    const palavra = t.slice(WORD_TARGET_PREFIX.length);
    if (!palavra) return;
    const alvo = (mods.word[palavra] ||= {
      bonus: 0, dice: 0, rollDice: 0, reroll1: 0, reroll6: 0, critBonus: 0, failBonus: 0,
    });
    switch (effect.type) {
      case "bonus": case "attr": alvo.bonus += v; break;
      case "dice": alvo.dice += v; break;
      case "rollDice": alvo.rollDice += v; break;
      case "reroll1": alvo.reroll1 = combineReroll(alvo.reroll1, effect.rerollAll ? "all" : v); break;
      case "reroll6": alvo.reroll6 = combineReroll(alvo.reroll6, effect.rerollAll ? "all" : v); break;
      case "crit": alvo.critBonus += v; break;
      case "fumble": alvo.failBonus += v; break;
      default: break; // os demais tipos não fazem sentido por palavra
    }
    return;
  }

  // Alvo "arma" (qualquer tipagem) ou "arma:<tipagem>": vale só para ações
  // de itens que carregam a tipagem. Mesmo balde separado das palavras.
  if (t === WEAPON_ANY_TARGET || t.startsWith(WEAPON_TAG_PREFIX)) {
    const tipagem = t === WEAPON_ANY_TARGET ? WEAPON_ANY_TARGET : t.slice(WEAPON_TAG_PREFIX.length);
    if (!tipagem) return;
    const alvo = (mods.weapon[tipagem] ||= {
      bonus: 0, dice: 0, rollDice: 0, reroll1: 0, reroll6: 0, critBonus: 0, failBonus: 0, damage: 0,
    });
    switch (effect.type) {
      case "bonus": case "attr": alvo.bonus += v; break;
      case "dice": alvo.dice += v; break;
      case "rollDice": alvo.rollDice += v; break;
      case "reroll1": alvo.reroll1 = combineReroll(alvo.reroll1, effect.rerollAll ? "all" : v); break;
      case "reroll6": alvo.reroll6 = combineReroll(alvo.reroll6, effect.rerollAll ? "all" : v); break;
      case "crit": alvo.critBonus += v; break;
      case "fumble": alvo.failBonus += v; break;
      // Dano por tipagem: "+1 de dano com armas de Haste".
      case "damage": alvo.damage += v; break;
      default: break;
    }
    return;
  }

  if (effect.type === "bonus") {
    // SÓ rolagem: nunca altera o valor do atributo (ver prepareDerivedData).
    if (mods.attr[t]) mods.attr[t].bonus += v;
    else if (mods.roll[t]) mods.roll[t].bonus += v;
  } else if (effect.type === "size") {
    // target "shift" → move N categorias (valor negativo diminui);
    // target = id de categoria → fixa aquela categoria.
    if (!effect.target || effect.target === "shift") mods.size.shift += v;
    else mods.size.set = effect.target;
  } else if (effect.type === "attr") {
    // Altera o ATRIBUTO em si. Só faz sentido em atributos (primários e
    // secundários); em categorias de rolagem, cai como bônus de rolagem.
    if (mods.attr[t]) mods.attr[t].attrBonus += v;
    else if (mods.roll[t]) mods.roll[t].bonus += v;
  } else if (effect.type === "rollDice") {
    // Só rolagem: nunca altera os dados do atributo na ficha.
    if (mods.attr[t]) mods.attr[t].rollDice += v;
    else if (mods.roll[t]) mods.roll[t].dice += v;
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

/* ======================================================================== */
/*  Nível das AÇÕES (mesma regra dos efeitos)                               */
/* ======================================================================== */

/**
 * A ação está disponível no nível atual do item?
 * Só habilidades e complicações têm nível; nos demais tipos, sempre true.
 * Diferente dos efeitos, NÃO exige que o item esteja ligado: ações são
 * executáveis mesmo em item ativável desligado (é o uso que o liga).
 * @param {Item} item
 * @param {object} action  entrada de system.actions
 */
export function actionIsAvailable(item, action) {
  if (!action) return false;
  if (item?.type === "habilidade" || item?.type === "complicacao") {
    return levelMeets(item.system?.level || "B", action.level || "all");
  }
  return true;
}

/* ======================================================================== */
/*  Ativações prévias                                                       */
/* ======================================================================== */

/**
 * Referência de uma ativação prévia, como texto: "tipo|idDoItem|índice|nome".
 *
 * O nome vai junto do id de propósito: ids de item são por ficha, então uma
 * habilidade copiada para outro personagem perderia a referência. Com o
 * nome, ela se reencontra na ficha nova.
 *
 * @param {"item"|"effect"|"action"} kind
 * @param {string} itemId
 * @param {number} index  índice do efeito/ação (ignorado em "item")
 * @param {string} nome
 * @returns {string}
 */
export function buildPreActivationRef(kind, itemId, index, nome) {
  const limpo = String(nome || "").replace(/\|/g, "/");
  return [kind, itemId, Number(index) || 0, limpo].join("|");
}

/**
 * Lê uma referência de ativação prévia.
 * @param {string} ref
 * @returns {{kind:string, itemId:string, index:number, itemName:string}}
 */
export function parsePreActivation(ref) {
  const partes = String(ref || "").split("|");
  const [kind = "", itemId = "", idx = "", ...resto] = partes;
  return {
    kind: kind || "",
    itemId: itemId || "",
    index: Number(idx) || 0,
    itemName: resto.join("|"),
  };
}

/**
 * Encontra o que uma referência de ativação prévia aponta, na ficha dada.
 *
 * Procura pelo id; não achando (item copiado para outra ficha, id trocado),
 * cai para o NOME. Devolve null quando nada corresponde — a ação segue sem
 * a ativação, em vez de travar.
 *
 * @param {Actor} actor
 * @param {string} ref
 * @returns {{kind:string, item:Item, index:number, effect?:object,
 *            action?:object, label:string}|null}
 */
export function resolvePreActivation(actor, ref) {
  const { kind, itemId, index, itemName } = parsePreActivation(ref);
  if (!kind) return null;
  const itens = actor?.items;
  if (!itens) return null;
  let item = itens.get?.(itemId) || null;
  if (!item && itemName) {
    item = [...itens].find((i) => i.name === itemName) || null;
  }
  if (!item) return null;

  if (kind === "item") {
    return { kind, item, index: 0, label: item.name };
  }
  if (kind === "effect") {
    const effect = (item.system?.effects || [])[index];
    if (!effect) return null;
    const nome = effect.label || `${effect.type || "efeito"} ${effect.target || ""}`.trim();
    return { kind, item, index, effect, label: `${item.name} — ${nome}` };
  }
  if (kind === "action") {
    const action = (item.system?.actions || [])[index];
    if (!action) return null;
    return { kind, item, index, action, label: `${item.name} — ${action.label || "Ação"}` };
  }
  return null;
}

/** Tipos de item cujo custo varia com o ESTADO (nível B/A/E). */
export const LEVELED_TYPES = ["habilidade", "complicacao"];

/**
 * CUSTOS que valem no estado atual do item.
 *
 * Uma habilidade pode cobrar uma coisa no Básico e outra no Avançado. Há dois
 * modos, escolhidos pela trava `costsCumulative` do item:
 *
 *  - ISOLADO (padrão): cada nível cobra só o custo marcado para ele. Uma
 *    habilidade Avançada paga o custo de Avançado, e não o de Básico.
 *  - CONJUNTO: o nível cobra o dele MAIS os dos níveis anteriores. A mesma
 *    habilidade Avançada paga Básico + Avançado.
 *
 * Custos marcados como "Sempre" entram nos dois modos. Em itens sem estado
 * (equipamento, magia, traço) só os "Sempre" valem — não há nível para
 * comparar, e cobrar um custo de "Avançado" ali seria invisível na ficha.
 *
 * @param {Item} item
 * @returns {Array<object>} entradas de system.costs que devem ser pagas
 */
export function costsForLevel(item) {
  const todos = item?.system?.costs || [];
  if (!LEVELED_TYPES.includes(item?.type)) {
    return todos.filter((c) => !c?.level || c.level === "all");
  }
  const atual = item.system?.level || "B";
  const conjunto = !!item.system?.costsCumulative;
  return todos.filter((c) => {
    const nivel = c?.level || "all";
    if (nivel === "all") return true;
    return conjunto ? levelMeets(atual, nivel) : nivel === atual;
  });
}

/**
 * Ações disponíveis de um item, preservando o ÍNDICE original de cada uma
 * (a execução na ficha e as emanações referenciam ações por índice).
 * @param {Item} item
 * @returns {Array<{action: object, index: number}>}
 */
export function availableActionsOf(item) {
  const list = item?.system?.actions || [];
  const out = [];
  list.forEach((action, index) => {
    if (actionIsAvailable(item, action)) out.push({ action, index });
  });
  return out;
}
