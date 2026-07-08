/**
 * Efeitos MECÂNICOS das condições do Ligeia.
 *
 * As condições continuam sendo marcadores na ficha (lista de pílulas). Este
 * módulo traduz as condições ativas em modificadores numéricos aplicados nas
 * rolagens e no dano. Condições puramente narrativas (Atordoado, Paralisado,
 * Dominado, Enfeitiçado, etc.) não geram modificador automático — ficam como
 * marcador para o Mestre conduzir.
 *
 * Várias condições "fazem a criatura ficar também" com outra condição. Isso é
 * modelado em IMPLIES e expandido transitivamente.
 */

const IMPLIES = {
  caido: ["lento", "indefeso"],
  cego: ["indefeso"],
  exausto: ["lento"],
  atordoado: ["indefeso"],
  agarrado: ["imobilizado", "indefeso"],
  inconsciente: ["indefeso"],
  paralisado: ["indefeso"],
  dominado: ["pasmo"],
};

/**
 * Expande um conjunto de ids de condição com as condições implicadas
 * (transitivo). Ex.: ["caido"] → {caido, lento, indefeso}.
 */
export function expandConditions(ids) {
  const out = new Set(ids || []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Array.from(out)) {
      for (const imp of IMPLIES[id] || []) {
        if (!out.has(imp)) { out.add(imp); changed = true; }
      }
    }
  }
  return out;
}

/**
 * Calcula os modificadores mecânicos das condições ativas de um ator.
 *
 *  atkDice / defDice — dados de melhoria a somar (negativos = desvantagem)
 *    em rolagens de ataque / defesa. Cada condição relevante dá -1D e
 *    acumulam entre si (condições diferentes acumulam; a regra de "não
 *    acumular" é só para a MESMA condição de fontes diferentes).
 *      Caído: -1D em tudo (ataque e defesa)
 *      Exausto: -1D em tudo
 *      Cego: -1D em ataque (rolagens que exigem visão)
 *  esquivaMod — modificador no valor de Esquiva (-3 se Indefeso)
 *  blockDisabled — Indefeso não pode usar Bloqueio para defender
 *  damageDealtMult — 0.5 se Enfraquecido (causa metade do dano)
 *  damageTakenMult — 0.5 se Intangível (recebe metade do dano)
 *  moveMult — 0.5 se Lento (deslocamento pela metade)
 */
/**
 * Penalidade/bônus de DADOS por condição para um atributo específico.
 * Ex.: Surdo → -1D em rolagens de Conjuração.
 */
export function attributeConditionDice(actor, attrKey) {
  const set = expandConditions(actor?.system?.conditions || []);
  let dice = 0;
  if (set.has("surdo") && attrKey === "conjuracao") dice -= 1;
  return dice;
}

/** O ator tem a condição (considerando condições implícitas)? */
export function actorHasCondition(actor, id) {
  return expandConditions(actor?.system?.conditions || []).has(id);
}

export function conditionModifiers(actor) {
  const set = expandConditions(actor?.system?.conditions || []);
  let atkDice = 0;
  let defDice = 0;
  if (set.has("caido")) { atkDice -= 1; defDice -= 1; }
  if (set.has("exausto")) { atkDice -= 1; defDice -= 1; }
  if (set.has("cego")) { atkDice -= 1; } // visão → afeta ataque

  return {
    set,
    atkDice,
    defDice,
    esquivaMod: set.has("indefeso") ? -3 : 0,
    blockDisabled: set.has("indefeso"),
    damageDealtMult: set.has("enfraquecido") ? 0.5 : 1,
    damageTakenMult: set.has("intangivel") ? 0.5 : 1,
    moveMult: set.has("lento") ? 0.5 : 1,
  };
}
