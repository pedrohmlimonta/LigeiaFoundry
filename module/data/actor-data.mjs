/**
 * DataModels dos Actors do sistema Ligeia.
 */
const fields = foundry.data.fields;

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

    // ---- Máximos de recursos ----
    // PV = Vigor + bônus vocação + nível
    const hpMax = a.vigor.value + (this.resources.hp.bonus || 0) + lvl;
    // PM = Mente + bônus vocação + nível
    const mpMax = a.mente.value + (this.resources.mp.bonus || 0) + lvl;
    // PH = nível
    const heroicMax = lvl + (this.resources.heroic.bonus || 0);

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
  static defineSchema() {
    return {
      details: new fields.SchemaField({
        concept: new fields.StringField({ blank: true, initial: "" }),
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        notes: new fields.HTMLField({ blank: true, initial: "" }),
      }),
      conditions: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),
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
    this.secondary = {
      bloqueio: a.forca.value,
      esquiva: a.agilidade.value,
      conjuracao: a.mente.value,
      iniciativa: Math.max(a.agilidade.value, a.percepcao.value),
      iniciativaDice: Math.max(a.agilidade.dice, a.percepcao.dice),
      deslocamento: a.agilidade.value,
    };
    const hpMax = a.vigor.value + (this.resources.hp.bonus || 0) + lvl;
    const mpMax = a.mente.value + (this.resources.mp.bonus || 0) + lvl;
    const heroicMax = lvl + (this.resources.heroic.bonus || 0);
    this.resources.hp.max = hpMax;
    this.resources.mp.max = mpMax;
    this.resources.heroic.max = heroicMax;
    this.resources.hp.value = Math.max(0, Math.min(this.resources.hp.value, hpMax));
    this.resources.mp.value = Math.max(0, Math.min(this.resources.mp.value, mpMax));
    this.resources.heroic.value = Math.max(0, Math.min(this.resources.heroic.value, heroicMax));
    this.resources.hp.temp = Math.max(0, this.resources.hp.temp || 0);
  }
}
