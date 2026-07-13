/**
 * Cálculo de custo de XP e listas de acesso do Ligeia.
 *
 * Regra (Sessão 16 / Sessão 9 do livro):
 *  - Cada Raça, Herança, Vocação, Organização e Carreira concede ACESSO
 *    a uma lista de habilidades.
 *  - Comprar uma habilidade que está em alguma lista de acesso custa o
 *    valor normal (Básico 20 / Avançado 40 / Épico 80, ou o que a
 *    habilidade especificar).
 *  - Comprar uma habilidade FORA de todas as listas de acesso custa o
 *    DOBRO.
 */

/** Normaliza um nome para comparação (sem acentos, minúsculo, sem espaços extras). */
export function normalizeName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    // remove sufixo de subgrupo entre parênteses para comparar o nome base
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ");
}

/**
 * Coleta o conjunto de nomes de habilidades às quais o ator tem acesso,
 * a partir das Definições embutidas (raça/herança/vocação/organização) e
 * do campo de carreiras (texto livre, separado por vírgula — apenas
 * informativo, já que carreiras não carregam lista estruturada aqui).
 *
 * @param {Actor} actor
 * @returns {Set<string>} nomes normalizados
 */
export function collectAccessLists(actor) {
  const access = new Set();
  const defTypes = ["raca", "heranca", "vocacao", "organizacao"];
  for (const item of actor.items) {
    if (!defTypes.includes(item.type)) continue;
    const list = item.system?.skillList || [];
    for (const name of list) {
      const n = normalizeName(name);
      if (n) access.add(n);
    }
  }
  return access;
}

/**
 * Custo base de uma habilidade conforme o nível adquirido.
 * Prioriza os custos definidos NO PRÓPRIO item (costBasic/costAdvanced/
 * costSpecial); se forem 0, cai na tabela padrão do CONFIG.
 *
 * @param {Item} skillItem  item do tipo "habilidade"
 * @param {string} level  "B" | "A" | "E"
 * @returns {number}
 */
export function baseSkillCost(skillItem, level) {
  const table = CONFIG.LIGEIA?.skillCost || { B: 20, A: 40, E: 80 };
  const sys = skillItem?.system || {};
  const perItem = { B: sys.costBasic, A: sys.costAdvanced, E: sys.costSpecial };
  const custom = Number(perItem[level]) || 0;
  if (custom > 0) return custom;
  return table[level] ?? 0;
}

/**
 * Calcula o custo de uma habilidade para este ator, considerando se ela
 * está dentro de alguma lista de acesso.
 *
 * @param {Item} skillItem  item do tipo "habilidade"
 * @param {Set<string>} accessLists  retorno de collectAccessLists
 * @returns {{ base: number, onList: boolean, multiplier: number, total: number }}
 */
export function skillCostFor(skillItem, accessLists) {
  const base = baseSkillCost(skillItem, skillItem.system?.level || "B");
  const name = normalizeName(skillItem.name);
  const onList = accessLists.has(name);
  const multiplier = onList ? 1 : (CONFIG.LIGEIA?.offListMultiplier || 2);
  return {
    base,
    onList,
    multiplier,
    total: base * multiplier,
  };
}

/**
 * Soma o XP gasto em todas as habilidades do ator, aplicando o dobro
 * para as que estão fora das listas de acesso.
 *
 * @param {Actor} actor
 * @returns {{ spent: number, perSkill: Array }}
 */
export function computeXpSpent(actor) {
  const access = collectAccessLists(actor);
  let spent = 0;
  const perSkill = [];
  for (const item of actor.items) {
    if (item.type !== "habilidade") continue;
    const cost = skillCostFor(item, access);
    spent += cost.total;
    perSkill.push({ id: item.id, name: item.name, ...cost });
  }
  return { spent, perSkill };
}

/**
 * XP concedido pelas COMPLICAÇÕES do personagem. Complicações são o oposto de
 * um custo: cada uma adiciona ao XP disponível do personagem.
 * @returns {{reward:number, perComplication:Array}}
 */
export function computeXpReward(actor) {
  let reward = 0;
  const perComplication = [];
  for (const item of actor.items) {
    if (item.type !== "complicacao") continue;
    const value = Math.max(0, Number(item.system?.xpReward) || 0);
    reward += value;
    perComplication.push({ id: item.id, name: item.name, value });
  }
  return { reward, perComplication };
}
