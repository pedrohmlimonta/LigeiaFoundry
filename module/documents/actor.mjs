/**
 * Classe base de Actor do Ligeia.
 * A maior parte da lógica derivada vive nos DataModels (prepareDerivedData).
 */
export class LigeiaActor extends Actor {
  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    // Os DataModels já calculam secundários/recursos via prepareDerivedData.
  }

  /**
   * Monta a rolagem de Iniciativa do combate usando a MESMA mecânica das
   * rolagens da ficha: 2d6 + dados de melhoria, mantendo os 2 maiores
   * (kh2); com desvantagem (dados negativos) mantém os 2 menores (kl2).
   * Soma o valor de Iniciativa + modificadores de efeitos de categoria "all".
   *
   * Isto sobrescreve a fórmula estática de CONFIG.Combat.initiative para que
   * o carrossel de iniciativa reflita os efeitos (dados e bônus) que também
   * aparecem na ficha.
   * @override
   */
  getInitiativeRoll(formula) {
    const sys = this.system || {};
    const sec = sys.secondary || {};
    const value = sec.iniciativa || 0;
    // Dados de melhoria da iniciativa (já incluem efeitos via prepareDerivedData)
    let dice = sec.iniciativaDice || 0;
    // Modificadores de categoria "all" (efeitos que afetam todas as rolagens)
    const rm = sys.rollMods || {};
    dice += rm.all?.dice || 0;
    const bonus = value + (rm.all?.bonus || 0);

    const extra = Math.abs(dice);
    const totalDice = 2 + extra;
    const keep = dice < 0 ? "kl2" : "kh2";

    // ----- Reroll (1s e/ou 6s) -----
    // Combina o reroll do atributo "iniciativa" com o da categoria "all".
    // O carrossel monta a Roll a partir da fórmula, então usamos os
    // modificadores nativos do Foundry: `ro1` rerrola (uma vez) os dados que
    // caem 1; `ro6` os que caem 6. Vale tanto para "todos" quanto para uma
    // contagem ≥1 (o Foundry não diferencia contagem na fórmula; havendo
    // qualquer reroll daquele valor, aplica o modificador).
    const ar = sys.attrReroll?.iniciativa || {};
    const has = (a, b) => a === "all" || a === Infinity || (Number(a) || 0) > 0
                       || b === "all" || b === Infinity || (Number(b) || 0) > 0;
    const rerollOnes = has(ar.reroll1, rm.all?.reroll1);
    const rerollSixes = has(ar.reroll6, rm.all?.reroll6);
    let diceMods = "";
    if (rerollOnes) diceMods += "ro1";
    if (rerollSixes) diceMods += "rr6";

    const parts = [`${totalDice}d6${diceMods}${keep}`];
    if (bonus !== 0) parts.push(`${bonus >= 0 ? "+" : "-"} ${Math.abs(bonus)}`);
    return new Roll(parts.join(" "), this.getRollData());
  }
}
