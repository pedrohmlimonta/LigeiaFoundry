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

/**
 * Condições que dão +1D DEFENSIVO por não ser visto e que podem ser anuladas
 * quando o ATACANTE tem a condição de percepção correspondente.
 */
const PERCEPTION_COUNTER = {
  oculto: "vendo_oculto",
  invisivel: "vendo_invisivel",
};

/**
 * Dados de melhoria DEFENSIVOS por cobertura e por não ser visto — o único
 * cálculo do sistema que depende dos dois lados: um alvo Oculto/Invisível não
 * ganha nada contra quem tem Vendo Oculto / Vendo Invisível.
 *
 * @param {Actor} defender
 * @param {Actor} [attacker]
 * @returns {{dice:number, notes:string[]}}
 */
export function coverDefenseDice(defender, attacker = null) {
  const def = expandConditions(defender?.system?.conditions || []);
  const atk = expandConditions(attacker?.system?.conditions || []);
  let dice = 0;
  const notes = [];
  // Cobertura é física: a percepção do atacante não anula.
  if (def.has("cobertura_parcial")) { dice += 1; notes.push("cobertura parcial"); }
  for (const [cond, counter] of Object.entries(PERCEPTION_COUNTER)) {
    if (!def.has(cond)) continue;
    if (atk.has(counter)) continue; // o atacante enxerga: sem bônus
    dice += 1;
    notes.push(cond === "oculto" ? "ocultação" : "invisibilidade");
  }
  return { dice, notes };
}

/** O alvo está em cobertura completa (não pode sofrer o ataque)? */
export function hasFullCover(defender) {
  return expandConditions(defender?.system?.conditions || []).has("cobertura_completa");
}

/**
 * Sincroniza os efeitos aplicados do tipo "condição" com a lista de condições
 * do ator: o efeito grava em conditionId a condição escolhida, ela é marcada
 * enquanto o efeito existir e sai quando ele é removido (a menos que outro
 * efeito ativo ainda a sustente). Assim, criar o efeito na aba Efeitos &
 * Condições tem o mesmo comportamento de aplicá-lo por uma ação.
 *
 * @param {Array} nextFx  efeitos aplicados que estão sendo gravados
 * @param {Array} prevFx  efeitos aplicados anteriores
 * @param {Array} currentConditions  condições atuais do ator
 * @returns {{conditions: string[], changed: boolean}}
 */
export function syncConditionEffects(nextFx, prevFx, currentConditions) {
  const condOf = (ae) => {
    const e = (ae?.effects || []).find((x) => x?.type === "condition" && x?.target);
    return e ? e.target : null;
  };
  // Grava conditionId a partir do efeito escolhido no editor.
  for (const ae of nextFx || []) {
    const id = condOf(ae);
    if (id) ae.conditionId = id;
    else if (ae && (prevFx || []).some((p) => p?.fxId && p.fxId === ae.fxId && condOf(p))) {
      ae.conditionId = ""; // deixou de ser efeito de condição
    }
  }
  const antes = new Set((prevFx || []).map((ae) => ae?.conditionId).filter(Boolean));
  const agora = new Set(
    (nextFx || []).filter((ae) => !ae?.disabled).map((ae) => ae?.conditionId).filter(Boolean),
  );
  const out = new Set(currentConditions || []);
  const before = Array.from(out).join("|");
  for (const id of antes) if (!agora.has(id)) out.delete(id);
  for (const id of agora) out.add(id);
  const conditions = Array.from(out);
  return { conditions, changed: conditions.join("|") !== before };
}

/** Bônus de iniciativa por iniciar o combate oculto. */
export function initiativeConditionBonus(actor) {
  return expandConditions(actor?.system?.conditions || []).has("oculto") ? 4 : 0;
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
