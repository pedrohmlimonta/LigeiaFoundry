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

import { resolveEffectValue } from "./effects.mjs";

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
 * O campo de custo foi PREENCHIDO?
 *
 * Vazio significa "usa a tabela padrão do sistema". Um valor escrito —
 * inclusive **zero** — significa aquele custo e mais nada: uma habilidade
 * marcada com 0 é de graça, não de 20.
 *
 * (Antes o campo era numérico e 0 valia como "não preenchido", o que tornava
 * impossível declarar uma habilidade gratuita. A migração do item converte
 * os zeros antigos em vazio, preservando o que os mundos já tinham.)
 *
 * @param {*} bruto
 * @returns {boolean}
 */
export function custoPreenchido(bruto) {
  if (bruto === null || bruto === undefined) return false;
  return String(bruto).trim() !== "";
}

/**
 * Custo base de uma habilidade conforme o nível adquirido.
 *
 * Usa o custo escrito NO PRÓPRIO item (costBasic/costAdvanced/costSpecial)
 * quando ele existe — zero incluso — e cai na tabela do CONFIG quando o
 * campo está vazio. O campo aceita fórmula com @variáveis, como os demais
 * valores do sistema.
 *
 * @param {Item} skillItem  item do tipo "habilidade"
 * @param {string} level  "B" | "A" | "E"
 * @returns {number}
 */
export function baseSkillCost(skillItem, level) {
  const table = CONFIG.LIGEIA?.skillCost || { B: 20, A: 40, E: 80 };
  const sys = skillItem?.system || {};
  const perItem = { B: sys.costBasic, A: sys.costAdvanced, E: sys.costSpecial };
  const bruto = perItem[level];
  if (!custoPreenchido(bruto)) return table[level] ?? 0;
  return Math.max(0, resolveEffectValue(bruto, skillItem?.parent));
}

/**
 * HABILIDADES-CHAVE que as vocações do personagem concedem.
 *
 * Toda vocação tem uma ou mais habilidades-chave: elas já vêm com o
 * personagem e não custam XP. A comparação é por nome normalizado, então a
 * habilidade continua gratuita mesmo que tenha sido adicionada à mão, e
 * volta a custar se a vocação sair da ficha.
 *
 * @param {Actor} actor
 * @returns {Set<string>} nomes normalizados
 */
export function collectKeySkills(actor) {
  const chaves = new Set();
  for (const item of actor?.items || []) {
    if (item.type !== "vocacao") continue;
    for (const k of item.system?.keySkills || []) {
      const n = normalizeName(k?.name);
      if (n) chaves.add(n);
    }
  }
  return chaves;
}

/**
 * Calcula o custo de uma habilidade para este ator, considerando se ela
 * está dentro de alguma lista de acesso.
 *
 * @param {Item} skillItem  item do tipo "habilidade"
 * @param {Set<string>} accessLists  retorno de collectAccessLists
 * @returns {{ base: number, onList: boolean, multiplier: number, total: number }}
 */
export function skillCostFor(skillItem, accessLists, keySkills = null) {
  const base = baseSkillCost(skillItem, skillItem.system?.level || "B");
  const name = normalizeName(skillItem.name);
  const onList = accessLists.has(name);
  // Habilidade-chave de uma vocação do personagem: vem junto com a vocação
  // e não custa nada, esteja ou não nas listas de acesso.
  const isKey = !!keySkills?.has(name);
  const multiplier = onList ? 1 : (CONFIG.LIGEIA?.offListMultiplier || 2);
  return {
    base,
    onList,
    isKey,
    multiplier: isKey ? 0 : multiplier,
    total: isKey ? 0 : base * multiplier,
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
  const chaves = collectKeySkills(actor);
  let spent = 0;
  const perSkill = [];
  for (const item of actor.items) {
    if (item.type !== "habilidade") continue;
    const cost = skillCostFor(item, access, chaves);
    spent += cost.total;
    perSkill.push({ id: item.id, name: item.name, ...cost });
  }
  return { spent, perSkill };
}

/**
 * XP CONCEDIDO por uma complicação conforme o nível.
 * Prioriza os valores definidos NO PRÓPRIO item (xpBasic/xpAdvanced/
 * xpSpecial); se forem 0, cai na tabela padrão do CONFIG.
 *
 * @param {Item} compItem  item do tipo "complicacao"
 * @param {string} level  "B" | "A" | "E"
 * @returns {number}
 */
export function baseComplicationXp(compItem, level) {
  const table = CONFIG.LIGEIA?.complicationXp || { B: 20, A: 40, E: 80 };
  const sys = compItem?.system || {};
  const perItem = { B: sys.xpBasic, A: sys.xpAdvanced, E: sys.xpSpecial };
  const bruto = perItem[level];
  // Mesma regra do custo das habilidades: vazio usa a tabela, escrito vale
  // como está — uma complicação que não concede nada pode valer 0.
  if (!custoPreenchido(bruto)) return table[level] ?? 0;
  return Math.max(0, resolveEffectValue(bruto, compItem?.parent));
}

/**
 * Soma o XP CONCEDIDO por todas as complicações do ator. Complicações são
 * o inverso das habilidades: em vez de custar XP, cada uma ADICIONA o seu
 * valor ao total de XP disponível do personagem.
 *
 * @param {Actor} actor
 * @returns {{ gained: number, perComplication: Array }}
 */
export function computeXpGained(actor) {
  let gained = 0;
  const perComplication = [];
  for (const item of actor.items) {
    if (item.type !== "complicacao") continue;
    const xp = baseComplicationXp(item, item.system?.level || "B");
    gained += xp;
    perComplication.push({ id: item.id, name: item.name, xp });
  }
  return { gained, perComplication };
}
