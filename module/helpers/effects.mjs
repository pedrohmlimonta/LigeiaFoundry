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
  // Nível só se aplica a habilidades e complicações. Vale o nível que está
  // sendo ATIVADO, não o adquirido: ativar no Básico uma habilidade que se
  // tem no Épico usa só os efeitos do Básico.
  if (item.type === "habilidade" || item.type === "complicacao") {
    return levelMeets(activationLevelOf(item), effect.level || "all");
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
 * Prefixo dos alvos que valem só nas rolagens para RESISTIR a efeitos de
 * uma condição: "resistir:cego" dá bônus nos testes contra o que cega.
 */
export const RESIST_TARGET_PREFIX = "resistir:";

/**
 * Prefixo dos alvos que valem só nas ações de um ITEM da ficha:
 * "item:Espada Longa" dá o bônus em qualquer ação daquela espada.
 * Casa pelo nome, normalizado, para sobreviver a cópias entre fichas.
 */
export const ITEM_TARGET_PREFIX = "item:";

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
  // tagsExtra é o campo ANTIGO (tipagens livres separadas por vírgula). A
  // migração do item junta tudo em `tags`, mas ele continua sendo lido aqui
  // para que um mundo ainda não migrado não perca as tipagens.
  const livres = String(sys.tagsExtra || "").split(",");
  const out = [];
  for (const t of [...marcadas, ...livres]) {
    const id = weaponTagId(t);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Tipagens de um item para EXIBIR: o id usado na comparação e o rótulo tal
 * como deve aparecer na tela.
 *
 * Uma tipagem inventada é guardada com o texto que a pessoa digitou
 * ("Forja Anã"), e não com o id normalizado, para que a acentuação e as
 * maiúsculas sobrevivam. O id continua sendo a forma normalizada, que é o
 * que os efeitos comparam.
 *
 * @param {Item} item
 * @returns {Array<{id:string, label:string}>}
 */
export function weaponTagEntriesOf(item) {
  const sys = item?.system || {};
  const guardadas = [
    ...(Array.isArray(sys.tags) ? sys.tags : []),
    ...String(sys.tagsExtra || "").split(","),
  ];
  const vistos = new Set();
  const out = [];
  for (const bruto of guardadas) {
    const id = weaponTagId(bruto);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    out.push({ id, label: weaponTagLabel(bruto) });
  }
  return out;
}

/**
 * Rótulo de exibição de uma tipagem.
 *
 * Recebe o que está guardado, que pode ser um id do livro ("duas_maos") ou
 * o texto que a pessoa digitou ("Forja Anã"). No primeiro caso devolve o
 * rótulo do livro; no segundo, o próprio texto, limpo.
 *
 * @param {string} guardado
 * @returns {string}
 */
export function weaponTagLabel(guardado) {
  const bruto = String(guardado || "").trim();
  if (!bruto) return "";
  const doLivro = CONFIG?.LIGEIA?.weaponTags?.[bruto]
    || CONFIG?.LIGEIA?.weaponTags?.[weaponTagId(bruto)];
  if (doLivro) return doLivro;
  // Texto digitado: fica como está. Só um id cru (sem espaço, com
  // underscore) é reconstruído em palavras.
  if (/^[a-z0-9]+(_[a-z0-9]+)*$/.test(bruto) && bruto.includes("_")) {
    return bruto.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  }
  return bruto;
}

/**
 * As categorias de DEFESA como alvos de efeito, com rótulo legível.
 *
 * Além de "Defesa (qualquer)", há a origem do ataque (corpo a corpo, à
 * distância, magia) e a combinação dela com o atributo que defende —
 * "Esquiva contra magia", "Bloqueio corpo a corpo".
 *
 * @returns {Record<string,string>}
 */
export function defesasComoAlvos() {
  const rotuloOrigem = { Melee: "corpo a corpo", Ranged: "à distância", Magia: "magia" };
  const rotuloAttr = { esquiva: "Esquiva", bloqueio: "Bloqueio" };
  const out = {
    defense: "Defesa (qualquer)",
    defenseMelee: "Defesa (corpo a corpo)",
    defenseRanged: "Defesa (à distância)",
    defenseMagia: "Defesa (magia)",
  };
  for (const a of DEFENSE_ATTRS) {
    for (const o of ATTACK_ORIGINS) {
      out[`${a}${o}`] = `${rotuloAttr[a]} (${rotuloOrigem[o]})`;
    }
  }
  return out;
}

/**
 * Tipagens que o mundo já conhece, para sugerir no campo de texto.
 *
 * O alvo de arma é digitado (ver tipagensComoAlvos), então a lista do livro
 * vira sugestão de autocompletar em vez de um seletor.
 *
 * @returns {string[]} rótulos em ordem alfabética
 */
export function tipagensConhecidas() {
  const vistos = new Map();
  for (const [id, label] of Object.entries(CONFIG?.LIGEIA?.weaponTags || {})) vistos.set(id, label);
  const varrer = (itens) => {
    for (const it of itens || []) {
      const guardadas = [
        ...(Array.isArray(it?.system?.tags) ? it.system.tags : []),
        ...String(it?.system?.tagsExtra || "").split(","),
      ];
      for (const t of guardadas) {
        const id = weaponTagId(t);
        if (id && !vistos.has(id)) vistos.set(id, weaponTagLabel(t));
      }
    }
  };
  try {
    varrer(globalThis.game?.items);
    for (const a of globalThis.game?.actors || []) varrer(a.items);
  } catch (e) { /* fora de um mundo carregado */ }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Condições como alvos de RESISTÊNCIA: "resistir:cego" dá bônus nas
 * rolagens para se livrar do que cega.
 *
 * @returns {Record<string,string>}
 */
export function resistenciasComoAlvos() {
  const out = {};
  for (const [id, def] of Object.entries(CONFIG?.LIGEIA?.conditions || {})) {
    out[`${RESIST_TARGET_PREFIX}${id}`] = `Resistir — ${def?.label || id}`;
  }
  return out;
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
  // "Arma — digite a tipagem" é um prefixo com argumento: escolhido no
  // seletor, o nome da tipagem vai no campo ao lado (ver mergeTargetArg).
  const out = { [WEAPON_TAG_PREFIX]: "Arma — tipagem (digite)" };
  const ids = Object.keys(CONFIG?.LIGEIA?.weaponTags || {});
  // tipagem inventada → rótulo como foi digitado (a primeira grafia vista)
  const extras = new Map();
  const varrer = (itens) => {
    for (const it of itens || []) {
      const guardadas = [
        ...(Array.isArray(it?.system?.tags) ? it.system.tags : []),
        ...String(it?.system?.tagsExtra || "").split(","),
      ];
      for (const t of guardadas) {
        const id = weaponTagId(t);
        if (id && !ids.includes(id) && !extras.has(id)) extras.set(id, weaponTagLabel(t));
      }
    }
  };
  try {
    varrer(globalThis.game?.items);
    for (const a of globalThis.game?.actors || []) varrer(a.items);
  } catch (e) { /* fora de um mundo carregado: só a lista do livro */ }
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
// Atributos de defesa que ganham categorias próprias por origem do ataque.
export const DEFENSE_ATTRS = ["esquiva", "bloqueio"];
// Origens de um ataque, do ponto de vista de quem se defende.
export const ATTACK_ORIGINS = ["Melee", "Ranged", "Magia"];

const ROLL_CATEGORIES = [
  "all", "attack", "defense",
  "attackMelee", "attackRanged",
  // Defesa por ORIGEM do ataque: corpo a corpo, à distância e magia.
  "defenseMelee", "defenseRanged", "defenseMagia",
  // E a combinação ATRIBUTO × ORIGEM: "esquiva contra magias",
  // "bloqueio contra ataques à distância"...
  ...DEFENSE_ATTRS.flatMap((a) => ATTACK_ORIGINS.map((o) => `${a}${o}`)),
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
  // Bônus para RESISTIR a efeitos de uma condição: condição → modificadores.
  const resist = {};
  // Bônus nas ações de um ITEM específico: nome normalizado → modificadores.
  const perItem = {};
  // IMUNIDADES declaradas por efeitos: cada balde guarda chaves normalizadas.
  const immune = { damage: new Set(), condition: new Set(), label: new Set(), item: new Set() };
  // CRÍTICO AUTOMÁTICO: conjunto de alvos de rolagem em que o personagem
  // crita sem precisar dos dados (mesmos alvos do bônus de rolagem).
  const autocrit = new Set();
  return { attr, roll, stat, size, word, weapon, resist, perItem, immune, autocrit };
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

  // IMUNIDADE: não é um número, é uma trava. O alvo diz a QUE se é imune.
  if (effect.type === "immune") {
    const bruto = String(effect.target || "").trim();
    if (!bruto) return;
    // "dano:fogo", "condicao:cego", "efeito:Maldição", "item:Espada"
    const sep = bruto.indexOf(":");
    const tipo = sep > 0 ? bruto.slice(0, sep) : "dano";
    const chave = sep > 0 ? bruto.slice(sep + 1) : bruto;
    if (!chave) return;
    const balde = { dano: "damage", condicao: "condition", efeito: "label", item: "item" }[tipo];
    if (!balde) return;
    // Tipo de dano e condição são ids; nome de efeito e de item são texto
    // digitado, então entram normalizados para casar sem acento nem caixa.
    mods.immune[balde].add(balde === "damage" || balde === "condition" ? chave : normalizeKey(chave));
    return;
  }

  // CRÍTICO AUTOMÁTICO: marca o alvo de rolagem em que o personagem crita
  // sem depender dos dados. Aceita os mesmos alvos do bônus de rolagem.
  if (effect.type === "autocrit") {
    mods.autocrit.add(String(effect.target || "all"));
    return;
  }

  // Alvo "resistir:<condicao>": vale nas rolagens para se livrar de um
  // efeito que aplica aquela condição.
  if (t.startsWith(RESIST_TARGET_PREFIX)) {
    const cond = t.slice(RESIST_TARGET_PREFIX.length);
    if (!cond) return;
    const alvo = (mods.resist[cond] ||= {
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
      default: break;
    }
    return;
  }

  // Alvo "item:<nome>": vale em qualquer ação daquele item da ficha.
  if (t.startsWith(ITEM_TARGET_PREFIX)) {
    const nome = normalizeKey(t.slice(ITEM_TARGET_PREFIX.length));
    if (!nome) return;
    const alvo = (mods.perItem[nome] ||= {
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
      case "damage": alvo.damage += v; break;
      default: break;
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
    // Idem: o que vale é o nível ativado.
    return levelMeets(activationLevelOf(item), action.level || "all");
  }
  return true;
}

/**
 * Modificadores para RESISTIR a um efeito, conforme a condição que ele
 * aplica.
 *
 * Assim como há bônus para rolar magia ou para rolar com certas armas, aqui
 * há bônus para se livrar do que cega, do que envenena, do que atordoa.
 * Vale tanto na rolagem de encerramento quanto no teste de resistência.
 *
 * @param {Actor} actor  quem está resistindo
 * @param {string} condId  condição que o efeito aplica ("" se nenhuma)
 * @returns {{bonus:number, dice:number, rollDice:number, critBonus:number,
 *            failBonus:number, reroll1:(number|string), reroll6:(number|string)}}
 */
export function resistMods(actor, condId) {
  const vazio = {
    bonus: 0, dice: 0, rollDice: 0, critBonus: 0, failBonus: 0, reroll1: 0, reroll6: 0,
  };
  const mapa = actor?.system?.resistMods;
  if (!mapa || !condId) return vazio;
  const m = mapa[condId];
  if (!m) return vazio;
  return {
    bonus: m.bonus || 0, dice: m.dice || 0, rollDice: m.rollDice || 0,
    critBonus: m.critBonus || 0, failBonus: m.failBonus || 0,
    reroll1: m.reroll1 || 0, reroll6: m.reroll6 || 0,
  };
}

/* ======================================================================== */
/*  Alvos com argumento digitado                                            */
/* ======================================================================== */

/**
 * Prefixos de alvo que pedem um TEXTO para completar.
 *
 * O seletor oferece o prefixo ("Item desta ficha", "Arma — tipagem…") e um
 * campo ao lado recebe o nome. O que fica guardado é a junção dos dois:
 * "item:Espada Longa", "arma:haste", "efeito:Maldição".
 */
export const TARGET_ARG_PREFIXES = [ITEM_TARGET_PREFIX, WEAPON_TAG_PREFIX, "efeito:", "item:"];

/** O alvo pede um texto para completar? Devolve o prefixo, ou "". */
export function targetArgPrefix(alvo) {
  const t = String(alvo || "");
  // O mais longo primeiro, para "item:" não engolir um prefixo maior.
  const achado = [...new Set(TARGET_ARG_PREFIXES)]
    .sort((a, b) => b.length - a.length)
    .find((p) => t.startsWith(p));
  return achado || "";
}

/** Separa "item:Espada Longa" em { prefixo: "item:", arg: "Espada Longa" }. */
export function splitTargetArg(alvo) {
  const prefixo = targetArgPrefix(alvo);
  if (!prefixo) return { prefixo: "", arg: "" };
  return { prefixo, arg: String(alvo || "").slice(prefixo.length) };
}

/**
 * Junta o prefixo escolhido no seletor com o texto digitado ao lado.
 *
 * O formulário manda os dois separados (`target` com o prefixo, `targetArg`
 * com o texto) porque um select e um input não podem dividir o mesmo nome.
 * Aqui eles voltam a ser um valor só, e o campo auxiliar é descartado.
 *
 * @param {object} entrada  um efeito, com target/targetArg (ou fxTarget/fxTargetArg)
 * @param {string} [campo]  "target" ou "fxTarget"
 */
export function mergeTargetArg(entrada, campo = "target") {
  if (!entrada || typeof entrada !== "object") return entrada;
  const campoArg = `${campo}Arg`;
  if (!(campoArg in entrada)) return entrada;
  const arg = String(entrada[campoArg] ?? "").trim();
  delete entrada[campoArg];
  const prefixo = targetArgPrefix(entrada[campo]);
  if (!prefixo) return entrada;
  // Tipagem de arma em branco quer dizer "qualquer arma tipada", que é o
  // alvo próprio para isso — e não "arma:" , que não casaria com nada.
  if (prefixo === WEAPON_TAG_PREFIX) {
    // A tipagem é comparada pelo id normalizado ("Duas Mãos" → duas_maos).
    entrada[campo] = arg ? `${prefixo}${weaponTagId(arg)}` : WEAPON_ANY_TARGET;
  } else {
    entrada[campo] = `${prefixo}${arg}`;
  }
  return entrada;
}

/* ======================================================================== */
/*  Imunidades                                                              */
/* ======================================================================== */

/**
 * O personagem é imune a um TIPO DE DANO?
 * @param {Actor} actor
 * @param {string} tipo  id do tipo ("fogo", "corte"...)
 */
export function immuneToDamage(actor, tipo) {
  const lista = actor?.system?.immunities?.damage;
  if (!Array.isArray(lista) || !lista.length || !tipo) return false;
  return lista.includes(tipo);
}

/**
 * O personagem é imune a uma CONDIÇÃO?
 * @param {Actor} actor
 * @param {string} condId
 */
export function immuneToCondition(actor, condId) {
  const lista = actor?.system?.immunities?.condition;
  if (!Array.isArray(lista) || !lista.length || !condId) return false;
  return lista.includes(condId);
}

/**
 * O personagem é imune a um efeito por CIRCUNSTÂNCIA (o nome do efeito) ou
 * por ITEM de origem?
 *
 * A circunstância casa por TRECHO do nome, sem acento nem caixa: uma
 * imunidade a "maldição" alcança "Maldição do Lodo". O item casa pelo nome
 * inteiro, normalizado.
 *
 * @param {Actor} actor
 * @param {{label?:string, itemName?:string}} oque
 * @returns {string} o motivo da imunidade, ou "" se não há
 */
export function immunityReasonFor(actor, { label = "", itemName = "" } = {}) {
  const imm = actor?.system?.immunities;
  if (!imm) return "";
  const nome = normalizeKey(label);
  if (nome) {
    for (const trecho of imm.label || []) {
      if (trecho && nome.includes(trecho)) return `imune a "${trecho}"`;
    }
  }
  const item = normalizeKey(itemName);
  if (item && (imm.item || []).includes(item)) return `imune a ${itemName}`;
  return "";
}

/* ======================================================================== */
/*  Remoção de efeitos ativos (dissipar / purificar)                        */
/* ======================================================================== */

/** Rótulos dos modos de busca, para a ficha e para o chat. */
export const REMOVE_FX_MODES = {
  label: "Pelo nome",
  condition: "Que marcam a condição",
  mine: "Os que eu apliquei",
  all: "Todos",
};

/**
 * Normaliza um texto digitado para servir de chave: sem acento, minúsculo,
 * sem espaços nas pontas. É o que faz "Espada Longa" casar com
 * "espada longa" entre fichas diferentes.
 */
export function normalizeKey(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ");
}

/** Normaliza para comparar nome de efeito: sem acento, minúsculo. */
function dobrarNome(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase();
}

/**
 * Quais efeitos ativos de um alvo uma regra de remoção alcança.
 *
 * Devolve os ÍNDICES na lista do alvo, para que quem chama possa remover
 * sem depender da identidade dos objetos.
 *
 * @param {Array<object>} lista   system.appliedEffects do alvo
 * @param {object} regra          { mode, value, count }
 * @param {object} [ctx]          { casterName, limite }
 * @returns {number[]} índices a remover, na ordem da lista
 */
export function matchEffectsToRemove(lista, regra, { casterName = "", limite = 0 } = {}) {
  const todos = Array.isArray(lista) ? lista : [];
  const modo = regra?.mode || "label";
  const alvoTexto = dobrarNome(regra?.value);

  const casa = (ae) => {
    if (!ae) return false;
    switch (modo) {
      case "all": return true;
      // Casa por TRECHO: "veneno" alcança "Veneno da Aranha".
      case "label": return !!alvoTexto && dobrarNome(ae.label).includes(alvoTexto);
      case "condition": return !!regra?.value && ae.conditionId === regra.value;
      case "mine": return !!casterName && dobrarNome(ae.source) === dobrarNome(casterName);
      default: return false;
    }
  };

  const achados = [];
  for (let i = 0; i < todos.length; i++) if (casa(todos[i])) achados.push(i);
  // Sem limite, tira todos os que casaram; com limite, os primeiros.
  return limite > 0 ? achados.slice(0, limite) : achados;
}

/**
 * Tira da lista os efeitos nos índices dados e devolve o que precisa ser
 * gravado: a lista nova, as condições que ficam órfãs e os itens que
 * precisam ser desencantados.
 *
 * As condições só saem se nenhum efeito ATIVO que fica ainda as sustente —
 * a mesma regra do botão de remover da ficha.
 *
 * @param {Array<object>} lista
 * @param {number[]} indices
 * @param {string[]} condicoesAtuais
 * @returns {{restantes:Array, condicoes:string[], removidos:Array, mudouCondicoes:boolean}}
 */
export function removeEffectsAt(lista, indices, condicoesAtuais = []) {
  const fora = new Set(indices);
  const restantes = [];
  const removidos = [];
  (Array.isArray(lista) ? lista : []).forEach((ae, i) => {
    (fora.has(i) ? removidos : restantes).push(ae);
  });

  const aindaAtivas = new Set(
    restantes.filter((ae) => ae && !ae.disabled && ae.conditionId).map((ae) => ae.conditionId),
  );
  const sair = new Set(
    removidos.map((ae) => ae?.conditionId).filter((c) => c && !aindaAtivas.has(c)),
  );
  const condicoes = (condicoesAtuais || []).filter((c) => !sair.has(c));
  return {
    restantes,
    condicoes,
    removidos,
    mudouCondicoes: sair.size > 0,
  };
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

/** Ordem dos níveis, do menor para o maior. */
export const LEVEL_SEQUENCE = ["B", "A", "E"];

/**
 * NÍVEL DE ATIVAÇÃO de um item: em qual nível ele está sendo usado agora.
 *
 * Uma coisa é o nível que o personagem ADQUIRIU (system.level, que é o que
 * ele pagou em XP); outra é o nível que ele escolhe USAR nesta ativação
 * (system.activeLevel). Quem tem a habilidade no Épico pode querer ativá-la
 * no Básico — pagando o custo do Básico e usando só os efeitos e ações do
 * Básico.
 *
 * Nunca passa do nível adquirido: escolher acima do que se tem não vale, e
 * um valor antigo acima do adquirido é rebaixado em vez de dar erro.
 *
 * @param {Item} item
 * @returns {string} "B" | "A" | "E"
 */
export function activationLevelOf(item) {
  const adquirido = item?.system?.level || "B";
  if (!LEVELED_TYPES.includes(item?.type)) return adquirido;
  const escolhido = item?.system?.activeLevel || "";
  if (!escolhido || !LEVEL_SEQUENCE.includes(escolhido)) return adquirido;
  return levelMeets(adquirido, escolhido) ? escolhido : adquirido;
}

/**
 * Níveis que o personagem pode escolher ao ativar: do Básico até o que ele
 * adquiriu. Para o seletor da ficha.
 *
 * @param {Item} item
 * @returns {Array<{id:string, label:string, on:boolean}>}
 */
export function activationLevelChoices(item) {
  if (!LEVELED_TYPES.includes(item?.type)) return [];
  const adquirido = item.system?.level || "B";
  const atual = activationLevelOf(item);
  const rotulos = { B: "Básico", A: "Avançado", E: "Épico" };
  return LEVEL_SEQUENCE
    .filter((n) => levelMeets(adquirido, n))
    .map((n) => ({ id: n, label: rotulos[n], on: n === atual }));
}

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
export const COST_LEVEL_MODES = {
  all: "Sempre",
  B: "Só Básico",
  A: "Só Avançado",
  E: "Só Épico",
  "A+": "Avançado + Básico",
  "E+": "Épico + Av. + Básico",
};

/** Separa "A+" em { nivel: "A", soma: true }. */
export function parseCostLevel(bruto) {
  const texto = String(bruto || "all");
  if (texto === "all") return { nivel: "all", soma: false };
  const soma = texto.endsWith("+");
  const nivel = soma ? texto.slice(0, -1) : texto;
  if (!LEVEL_SEQUENCE.includes(nivel)) return { nivel: "all", soma: false };
  return { nivel, soma };
}

export function costsForLevel(item, nivelAtivacao = null) {
  const todos = item?.system?.costs || [];
  if (!LEVELED_TYPES.includes(item?.type)) {
    return todos.filter((c) => parseCostLevel(c?.level).nivel === "all");
  }
  const ativacao = nivelAtivacao || activationLevelOf(item);

  // Os "Sempre" entram em qualquer ativação.
  const sempre = todos.filter((c) => parseCostLevel(c?.level).nivel === "all");
  const doNivel = (n) => todos.filter((c) => parseCostLevel(c?.level).nivel === n);

  // Desce a escada a partir do nível ativado: cobra o que está nele e, se
  // algum desses custos for do tipo "soma os inferiores", desce mais um
  // degrau e repete. Um custo marcado "Só no Avançado" para a descida ali;
  // um marcado "Avançado + Básico" puxa o Básico junto.
  const pagar = [];
  let i = LEVEL_SEQUENCE.indexOf(ativacao);
  while (i >= 0) {
    const nesteNivel = doNivel(LEVEL_SEQUENCE[i]);
    pagar.push(...nesteNivel);
    if (!nesteNivel.some((c) => parseCostLevel(c.level).soma)) break;
    i -= 1;
  }

  // Devolve na ordem original da lista, para a ficha não embaralhar.
  const escolhidos = new Set([...sempre, ...pagar]);
  return todos.filter((c) => escolhidos.has(c));
}

/**
 * AÇÕES QUE SÃO ALVO DE ALGUMA CADEIA nesta ficha.
 *
 * Varre todas as ações de todos os itens do personagem e devolve as que
 * aparecem como destino de uma cadeia, na forma "idDoItem:índice". A
 * resolução usa a mesma regra das referências (id, com o nome como
 * reserva), então uma habilidade copiada de outra ficha continua sendo
 * reconhecida.
 *
 * Só conta a cadeia LIGADA: uma entrada desmarcada não esconde nada.
 *
 * @param {Actor} actor
 * @returns {Set<string>}
 */
export function chainTargetKeys(actor) {
  const chaves = new Set();
  for (const it of actor?.items || []) {
    for (const acao of it.system?.actions || []) {
      for (const elo of acao?.chainActions || []) {
        if (!elo || elo.enabled === false || !elo.ref) continue;
        const alvo = resolvePreActivation(actor, elo.ref);
        if (alvo?.kind === "action") chaves.add(`${alvo.item.id}:${alvo.index}`);
      }
    }
  }
  return chaves;
}

/**
 * A ação deve aparecer com botão na ficha do personagem?
 *
 * Esconde apenas o que é alvo de uma cadeia e não pediu para aparecer. Uma
 * ação que ninguém encadeia aparece sempre — a primária não precisa de
 * permissão para existir.
 *
 * @param {Item} item
 * @param {object} action
 * @param {number} index
 * @param {Set<string>} alvosDeCadeia  saída de chainTargetKeys
 * @returns {boolean}
 */
export function actionShowsInSheet(item, action, index, alvosDeCadeia) {
  if (!alvosDeCadeia?.has(`${item?.id}:${index}`)) return true;
  return !!action?.showInSheet;
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
