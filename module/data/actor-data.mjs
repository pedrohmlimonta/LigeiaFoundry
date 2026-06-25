/**
 * DataModels dos Actors do sistema Ligeia.
 */
import { expandConditions } from "../helpers/conditions.mjs";
import { aggregateEffectModifiers } from "../helpers/effects.mjs";
import { effectField } from "./fields.mjs";
import { migrateEffectTargets } from "./fields.mjs";

const fields = foundry.data.fields;

/**
 * Campo para os efeitos aplicados diretamente em um ator (buffs/debuffs de
 * magias, encantamentos, etc.). Cada entrada tem:
 *  - label/icon: identificação
 *  - effects: lista de modificadores (mesma estrutura dos itens)
 *  - disabled: liga/desliga sem remover
 *  - duration: { rounds, remaining } em rodadas (0 = sem limite)
 *  - endRoll: { enabled, attr, dc } — rolagem por rodada para encerrar
 *  - source: nome de quem aplicou
 */
function appliedEffectsField() {
  return new fields.ArrayField(
    new fields.SchemaField({
      label: new fields.StringField({ blank: true, initial: "Efeito" }),
      icon: new fields.StringField({ blank: true, initial: "icons/svg/aura.svg" }),
      effects: effectField(),
      // Se este efeito ativa uma condição, guarda o id dela (para removê-la
      // quando o efeito terminar/for resistido).
      conditionId: new fields.StringField({ blank: true, initial: "" }),
      disabled: new fields.BooleanField({ initial: false }),
      duration: new fields.SchemaField({
        rounds: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        remaining: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      }),
      endRoll: new fields.SchemaField({
        enabled: new fields.BooleanField({ initial: false }),
        attr: new fields.StringField({ blank: true, initial: "mente" }),
        dc: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        // Quando true, a CD veio da rolagem de conjuração de quem aplicou.
        vsCast: new fields.BooleanField({ initial: false }),
      }),
      // Dano contínuo por rodada aplicado ao portador (0 = nenhum).
      tickDamage: new fields.SchemaField({
        amount: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        type: new fields.StringField({ blank: true, initial: "" }),
        resource: new fields.StringField({ initial: "hp", choices: ["hp", "mp", "heroic"] }),
      }),
      source: new fields.StringField({ blank: true, initial: "" }),
    }),
    { initial: [] },
  );
}

/* Atributo primário: valor + dados de melhoria */
function attrField(initial = 2) {
  return new fields.SchemaField({
    value: new fields.NumberField({ required: true, initial, integer: true, min: 0 }),
    dice: new fields.NumberField({ required: true, initial: 0, integer: true, min: 0 }),
  });
}

/* Recurso com atual/máximo + bônus do GM */
function resourceField() {
  return new fields.SchemaField({
    value: new fields.NumberField({ required: true, initial: 0, integer: true }),
    max: new fields.NumberField({ required: true, initial: 0, integer: true }),
    bonus: new fields.NumberField({ required: true, initial: 0, integer: true }),
  });
}

/* ================================================================== */
/*  PERSONAGEM                                                         */
/* ================================================================== */
export class PersonagemData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    return migrateEffectTargets(super.migrateData(source));
  }
  static defineSchema() {
    return {
      // Identidade
      details: new fields.SchemaField({
        concept: new fields.StringField({ blank: true, initial: "" }),
        race: new fields.StringField({ blank: true, initial: "" }),
        heritage: new fields.StringField({ blank: true, initial: "" }),
        vocation: new fields.StringField({ blank: true, initial: "" }),
        careers: new fields.StringField({ blank: true, initial: "" }),
        nation: new fields.StringField({ blank: true, initial: "" }),
        organizations: new fields.StringField({ blank: true, initial: "" }),
        level: new fields.NumberField({ initial: 1, integer: true, min: 1, max: 6 }),
        xp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        corruption: new fields.NumberField({ initial: 0, integer: true }),
        personality: new fields.HTMLField({ blank: true, initial: "" }),
        notes: new fields.HTMLField({ blank: true, initial: "" }),
      }),

      // Condições ativas (lista de ids; ver CONFIG.LIGEIA.conditions)
      conditions: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),

      // Efeitos aplicados diretamente na ficha (buffs/debuffs de magias,
      // encantamentos, etc.), com duração opcional e rolagem para encerrar.
      appliedEffects: appliedEffectsField(),

      // Atributos primários
      attributes: new fields.SchemaField({
        forca: attrField(2),
        agilidade: attrField(2),
        vigor: attrField(2),
        mente: attrField(2),
        percepcao: attrField(2),
      }),

      // Recursos
      resources: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true }),
          max: new fields.NumberField({ initial: 0, integer: true }),
          bonus: new fields.NumberField({ initial: 0, integer: true }),
          temp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        }),
        mp: resourceField(),
        heroic: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true }),
          max: new fields.NumberField({ initial: 0, integer: true }),
          bonus: new fields.NumberField({ initial: 0, integer: true }),
        }),
      }),

      // Bônus manuais do GM aplicados a secundários
      secondaryBonus: new fields.SchemaField({
        deslocamento: new fields.NumberField({ initial: 0, integer: true }),
        moveBonusRace: new fields.NumberField({ initial: 0, integer: true }),
      }),

      // Magia
      magic: new fields.SchemaField({
        knownWords: new fields.ArrayField(new fields.StringField({ blank: true })),
        minorSpells: new fields.HTMLField({ blank: true, initial: "" }),
      }),

      // Rolagem oculta por ficha
      rollHidden: new fields.BooleanField({ initial: false }),
    };
  }

  /**
   * Calcula valores derivados (secundários e máximos de recursos).
   * Chamado automaticamente pelo Foundry após preparar os dados base.
   */
  prepareDerivedData() {
    const a = this.attributes;
    const lvl = this.details.level || 1;

    // ---- Modificadores de efeitos ativos (itens + buffs na ficha) ----
    // Aplica bônus/dados aos ATRIBUTOS PRIMÁRIOS primeiro, para que os
    // secundários derivados (bloqueio=força, esquiva=agilidade, etc.) já
    // reflitam os efeitos. Guarda também os modificadores de categorias de
    // rolagem (all/attack/defense) em this.rollMods, para uso nas rolagens.
    const mods = aggregateEffectModifiers(this.parent);
    this.rollMods = mods.roll;
    // Reroll por atributo (primários + secundários) para as rolagens.
    this.attrReroll = {};
    this.attrCrit = {};
    for (const k of [...Object.keys(mods.attr)]) {
      this.attrReroll[k] = { reroll1: mods.attr[k].reroll1 || 0, reroll6: mods.attr[k].reroll6 || 0 };
      this.attrCrit[k] = { critBonus: mods.attr[k].critBonus || 0, failBonus: mods.attr[k].failBonus || 0 };
    }
    this.effectMods = mods; // exposto para depuração/uso externo
    for (const k of ["forca", "agilidade", "vigor", "mente", "percepcao"]) {
      if (a[k]) {
        a[k].value = (a[k].value || 0) + (mods.attr[k]?.bonus || 0);
        a[k].dice = (a[k].dice || 0) + (mods.attr[k]?.dice || 0);
        if (mods.attr[k]?.set !== null && mods.attr[k]?.set !== undefined) a[k].value = mods.attr[k].set;
      }
    }

    // ---- Atributos secundários ----
    this.secondary = {
      bloqueio: a.forca.value,
      esquiva: a.agilidade.value,
      conjuracao: a.mente.value,
      // Iniciativa = maior entre Agilidade e Percepção (herda dados de ambos)
      iniciativa: Math.max(a.agilidade.value, a.percepcao.value),
      iniciativaDice: Math.max(a.agilidade.dice, a.percepcao.dice),
      // Deslocamento = Agilidade + bônus racial + ajuste do GM
      deslocamento:
        a.agilidade.value +
        (this.secondaryBonus.moveBonusRace || 0) +
        (this.secondaryBonus.deslocamento || 0),
    };

    // Aplica bônus/dados de efeitos aos SECUNDÁRIOS (esquiva, bloqueio,
    // conjuração, iniciativa) por cima do valor derivado.
    this.secondary.bloqueio += mods.attr.bloqueio?.bonus || 0;
    this.secondary.esquiva += mods.attr.esquiva?.bonus || 0;
    this.secondary.conjuracao += mods.attr.conjuracao?.bonus || 0;
    this.secondary.iniciativa += mods.attr.iniciativa?.bonus || 0;
    this.secondary.iniciativaDice += mods.attr.iniciativa?.dice || 0;
    // Dados extras de bloqueio/esquiva/conjuração (herdam do primário, mas o
    // efeito pode adicionar) — guardados para o resolveAttr usar.
    this.secondary.bloqueioDice = (a.forca.dice || 0) + (mods.attr.bloqueio?.dice || 0);
    this.secondary.esquivaDice = (a.agilidade.dice || 0) + (mods.attr.esquiva?.dice || 0);
    this.secondary.conjuracaoDice = (a.mente.dice || 0) + (mods.attr.conjuracao?.dice || 0);
    // Deslocamento via efeito "stat"
    this.secondary.deslocamento += mods.stat.deslocamento || 0;

    // Lento (ou condições que implicam Lento, como Caído/Exausto): metade do
    // deslocamento, arredondado para baixo.
    const condSet = expandConditions(this.conditions || []);
    if (condSet.has("lento")) {
      this.secondary.deslocamento = Math.floor(this.secondary.deslocamento / 2);
      this.secondary.slowed = true;
    }

    // ---- Máximos de recursos ----
    // PV = Vigor + bônus vocação + nível (+ efeito stat hp)
    const hpMax = a.vigor.value + (this.resources.hp.bonus || 0) + lvl + (mods.stat.hp || 0);
    // PM = Mente + bônus vocação + nível (+ efeito stat mp)
    const mpMax = a.mente.value + (this.resources.mp.bonus || 0) + lvl + (mods.stat.mp || 0);
    // PH = nível (+ efeito stat heroic)
    const heroicMax = lvl + (this.resources.heroic.bonus || 0) + (mods.stat.heroic || 0);

    this.resources.hp.max = hpMax;
    this.resources.mp.max = mpMax;
    this.resources.heroic.max = heroicMax;

    // Clampa atuais ao máximo (não-negativo)
    this.resources.hp.value = Math.max(0, Math.min(this.resources.hp.value, hpMax));
    this.resources.mp.value = Math.max(0, Math.min(this.resources.mp.value, mpMax));
    this.resources.heroic.value = Math.max(0, Math.min(this.resources.heroic.value, heroicMax));
    this.resources.hp.temp = Math.max(0, this.resources.hp.temp || 0);
  }
}

/* ================================================================== */
/*  NPC (mesma base, simplificado)                                     */
/* ================================================================== */
export class NpcData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    return migrateEffectTargets(super.migrateData(source));
  }
  static defineSchema() {
    return {
      details: new fields.SchemaField({
        concept: new fields.StringField({ blank: true, initial: "" }),
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        notes: new fields.HTMLField({ blank: true, initial: "" }),
      }),
      conditions: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),
      appliedEffects: appliedEffectsField(),
      attributes: new fields.SchemaField({
        forca: attrField(2),
        agilidade: attrField(2),
        vigor: attrField(2),
        mente: attrField(2),
        percepcao: attrField(2),
      }),
      resources: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true }),
          max: new fields.NumberField({ initial: 0, integer: true }),
          bonus: new fields.NumberField({ initial: 0, integer: true }),
          temp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        }),
        mp: resourceField(),
        heroic: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true }),
          max: new fields.NumberField({ initial: 0, integer: true }),
          bonus: new fields.NumberField({ initial: 0, integer: true }),
        }),
      }),
      rollHidden: new fields.BooleanField({ initial: true }),
    };
  }

  prepareDerivedData() {
    const a = this.attributes;
    const lvl = this.details.level || 1;

    // Modificadores de efeitos ativos (itens + buffs na ficha)
    const mods = aggregateEffectModifiers(this.parent);
    this.rollMods = mods.roll;
    // Reroll por atributo (primários + secundários) para as rolagens.
    this.attrReroll = {};
    this.attrCrit = {};
    for (const k of [...Object.keys(mods.attr)]) {
      this.attrReroll[k] = { reroll1: mods.attr[k].reroll1 || 0, reroll6: mods.attr[k].reroll6 || 0 };
      this.attrCrit[k] = { critBonus: mods.attr[k].critBonus || 0, failBonus: mods.attr[k].failBonus || 0 };
    }
    for (const k of ["forca", "agilidade", "vigor", "mente", "percepcao"]) {
      if (a[k]) {
        a[k].value = (a[k].value || 0) + (mods.attr[k]?.bonus || 0);
        a[k].dice = (a[k].dice || 0) + (mods.attr[k]?.dice || 0);
        if (mods.attr[k]?.set !== null && mods.attr[k]?.set !== undefined) a[k].value = mods.attr[k].set;
      }
    }

    this.secondary = {
      bloqueio: a.forca.value,
      esquiva: a.agilidade.value,
      conjuracao: a.mente.value,
      iniciativa: Math.max(a.agilidade.value, a.percepcao.value),
      iniciativaDice: Math.max(a.agilidade.dice, a.percepcao.dice),
      deslocamento: a.agilidade.value,
    };
    this.secondary.bloqueio += mods.attr.bloqueio?.bonus || 0;
    this.secondary.esquiva += mods.attr.esquiva?.bonus || 0;
    this.secondary.conjuracao += mods.attr.conjuracao?.bonus || 0;
    this.secondary.iniciativa += mods.attr.iniciativa?.bonus || 0;
    this.secondary.iniciativaDice += mods.attr.iniciativa?.dice || 0;
    this.secondary.bloqueioDice = (a.forca.dice || 0) + (mods.attr.bloqueio?.dice || 0);
    this.secondary.esquivaDice = (a.agilidade.dice || 0) + (mods.attr.esquiva?.dice || 0);
    this.secondary.conjuracaoDice = (a.mente.dice || 0) + (mods.attr.conjuracao?.dice || 0);
    this.secondary.deslocamento += mods.stat.deslocamento || 0;

    const npcCond = expandConditions(this.conditions || []);
    if (npcCond.has("lento")) {
      this.secondary.deslocamento = Math.floor(this.secondary.deslocamento / 2);
      this.secondary.slowed = true;
    }
    const hpMax = a.vigor.value + (this.resources.hp.bonus || 0) + lvl + (mods.stat.hp || 0);
    const mpMax = a.mente.value + (this.resources.mp.bonus || 0) + lvl + (mods.stat.mp || 0);
    const heroicMax = lvl + (this.resources.heroic.bonus || 0) + (mods.stat.heroic || 0);
    this.resources.hp.max = hpMax;
    this.resources.mp.max = mpMax;
    this.resources.heroic.max = heroicMax;
    this.resources.hp.value = Math.max(0, Math.min(this.resources.hp.value, hpMax));
    this.resources.mp.value = Math.max(0, Math.min(this.resources.mp.value, mpMax));
    this.resources.heroic.value = Math.max(0, Math.min(this.resources.heroic.value, heroicMax));
    this.resources.hp.temp = Math.max(0, this.resources.hp.temp || 0);
  }
}
