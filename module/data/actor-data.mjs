/**
 * DataModels dos Actors do sistema Ligeia.
 */
import { expandConditions } from "../helpers/conditions.mjs";
import { actorRollData } from "../helpers/dice.mjs";
import { DEATH_HP } from "../helpers/wounds.mjs";
import { aggregateEffectModifiers } from "../helpers/effects.mjs";
import { effectField } from "./fields.mjs";
import { migrateEffectTargets } from "./fields.mjs";

const fields = foundry.data.fields;

/**
 * Soma os bônus concedidos pelas definições (itens) embutidas no ator:
 *  - Vocação → hpBonus (PV) e mpBonus (PM)
 *  - Raça → moveBonus (deslocamento)
 * Considera apenas a primeira vocação/raça encontrada (o personagem só pode
 * ter uma de cada). Retorna { hp, mp, move }.
 */
function definitionBonuses(actor) {
  const out = { hp: 0, mp: 0, move: 0 };
  if (!actor?.items) return out;
  for (const item of actor.items) {
    if (item.type === "vocacao") {
      out.hp += Number(item.system?.hpBonus) || 0;
      out.mp += Number(item.system?.mpBonus) || 0;
    } else if (item.type === "raca") {
      out.move += Number(item.system?.moveBonus) || 0;
    }
  }
  return out;
}

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
        // Número OU fórmula com @variáveis do portador (ex.: "@nivel").
        rounds: new fields.StringField({ blank: true, initial: "" }),
        remaining: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      }),
      endRoll: new fields.SchemaField({
        enabled: new fields.BooleanField({ initial: false }),
        attr: new fields.StringField({ blank: true, initial: "mente" }),
        dc: new fields.StringField({ blank: true, initial: "" }),
        // Quando true, a CD veio da rolagem de conjuração de quem aplicou.
        vsCast: new fields.BooleanField({ initial: false }),
        // Quando true, a CD é REFEITA a cada rodada: o atacante rola o atributo
        // abaixo de novo (rolagem resistida fresca), ignorando alcance. Guarda
        // quem é o atacante e qual atributo ele usa para o efeito.
        reroll: new fields.BooleanField({ initial: false }),
        attackerUuid: new fields.StringField({ blank: true, initial: "" }),
        attackerAttr: new fields.StringField({ blank: true, initial: "" }),
      }),
      // Dano contínuo por rodada aplicado ao portador (0 = nenhum).
      tickDamage: new fields.SchemaField({
        amount: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        type: new fields.StringField({ blank: true, initial: "" }),
        resource: new fields.StringField({ initial: "hp", choices: ["hp", "mp", "heroic"] }),
      }),
      // Regeneração contínua por rodada (contraparte do dano contínuo).
      tickHeal: new fields.SchemaField({
        amount: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        resource: new fields.StringField({ initial: "hp", choices: ["hp", "mp", "heroic"] }),
      }),
      // Sobrevida VINCULADA concedida por este efeito (0 = nenhuma).
      // Vidas ligadas: sobrevida zerou → o efeito termina; efeito terminou →
      // a sobrevida concedida some (ver helpers/barrier.mjs).
      tempHp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      // Id único para rastrear remoções (barreiras) entre atualizações.
      fxId: new fields.StringField({ blank: true, initial: "" }),
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
      // Não abrir a caixa de configuração antes das rolagens deste ator.
      skipRollDialog: new fields.BooleanField({ initial: false }),
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
    // ATENÇÃO: value e dice são a BASE editada na ficha (vão para o banco).
    // NUNCA sobrescrever aqui — a ficha renderiza esses campos nos <input>,
    // então gravar o valor buffado tornaria o efeito PERMANENTE e cumulativo.
    // Os efeitos entram apenas em campos DERIVADOS:
    //   total     = base + bônus de ATRIBUTO (ou "set")
    //   totalDice = dados base + dados de melhoria dos efeitos
    //   rollBonus = bônus que vale SÓ na rolagem (não altera o atributo)
    for (const k of ["forca", "agilidade", "vigor", "mente", "percepcao"]) {
      if (!a[k]) continue;
      const m = mods.attr[k] || {};
      const base = a[k].value || 0;
      a[k].total = (m.set !== null && m.set !== undefined) ? m.set : base + (m.attrBonus || 0);
      a[k].totalDice = (a[k].dice || 0) + (m.dice || 0);
      a[k].rollBonus = m.bonus || 0;
    }

    // Bônus concedidos pelas definições embutidas (vocação: PV/PM; raça: deslocamento)
    const defBonus = definitionBonuses(this.parent);

    // ---- CATEGORIA DE TAMANHO ----
    // Base: a raça do personagem (ou o padrão). Depois os efeitos: uma
    // categoria fixada tem prioridade e, sobre ela, somam-se os aumentos e
    // reduções de categoria.
    const sizes = CONFIG.LIGEIA?.sizes || {};
    const ordered = Object.entries(sizes).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
    const raceItem = this.parent?.items?.find?.((i) => i.type === "raca");
    let sizeKey = raceItem?.system?.size || CONFIG.LIGEIA?.defaultSize || "medio";
    if (!sizes[sizeKey]) sizeKey = CONFIG.LIGEIA?.defaultSize || "medio";
    const baseSizeKey = sizeKey;
    if (mods.size?.set && sizes[mods.size.set]) sizeKey = mods.size.set;
    if (mods.size?.shift) {
      const idx = ordered.findIndex(([k]) => k === sizeKey);
      const alvo = Math.min(ordered.length - 1, Math.max(0, idx + mods.size.shift));
      sizeKey = ordered[alvo]?.[0] || sizeKey;
    }
    const sizeDef = sizes[sizeKey] || { label: sizeKey, move: 0, hp: 0, weapon: 0, reach: 0 };
    this.size = {
      key: sizeKey,
      label: sizeDef.label || sizeKey,
      move: sizeDef.move || 0,
      hpMod: sizeDef.hp || 0,
      weaponBonus: sizeDef.weapon || 0,
      reach: sizeDef.reach || 0,
      token: Math.max(1, Number(sizeDef.token) || 1),
      base: baseSizeKey,
      changed: sizeKey !== baseSizeKey,
    };

    // ---- Atributos secundários ----
    this.secondary = {
      bloqueio: a.forca.total,
      esquiva: a.agilidade.total,
      conjuracao: a.mente.total,
      // Iniciativa = maior entre Agilidade e Percepção (herda dados de ambos)
      iniciativa: Math.max(a.agilidade.total, a.percepcao.total),
      iniciativaDice: Math.max(a.agilidade.totalDice, a.percepcao.totalDice),
      // Deslocamento = Agilidade + deslocamento da categoria de tamanho
      // (coluna bípede) + ajuste da raça + ajuste do GM
      deslocamento:
        a.agilidade.total +
        this.size.move +
        defBonus.move +
        (this.secondaryBonus.moveBonusRace || 0) +
        (this.secondaryBonus.deslocamento || 0),
    };

    // Aplica os bônus de ATRIBUTO dos efeitos aos SECUNDÁRIOS (esquiva,
    // bloqueio, conjuração, iniciativa) por cima do valor derivado. O bônus
    // de ROLAGEM fica separado em secondaryRollBonus (usado só ao rolar).
    for (const k of ["bloqueio", "esquiva", "conjuracao", "iniciativa"]) {
      const m = mods.attr[k] || {};
      this.secondary[k] += m.attrBonus || 0;
      if (m.set !== null && m.set !== undefined) this.secondary[k] = m.set;
    }
    this.secondaryRollBonus = {
      bloqueio: mods.attr.bloqueio?.bonus || 0,
      esquiva: mods.attr.esquiva?.bonus || 0,
      conjuracao: mods.attr.conjuracao?.bonus || 0,
      iniciativa: mods.attr.iniciativa?.bonus || 0,
      deslocamento: mods.attr.deslocamento?.bonus || 0,
    };
    this.secondary.iniciativaDice += mods.attr.iniciativa?.dice || 0;
    // Dados extras de bloqueio/esquiva/conjuração (herdam do primário, mas o
    // efeito pode adicionar) — guardados para o resolveAttr usar.
    this.secondary.bloqueioDice = (a.forca.totalDice || 0) + (mods.attr.bloqueio?.dice || 0);
    this.secondary.esquivaDice = (a.agilidade.totalDice || 0) + (mods.attr.esquiva?.dice || 0);
    this.secondary.conjuracaoDice = (a.mente.totalDice || 0) + (mods.attr.conjuracao?.dice || 0);
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
    // PV = Vigor + bônus da vocação + bônus manual + nível (+ efeito stat hp)
    const hpMax = a.vigor.total + defBonus.hp + this.size.hpMod + (this.resources.hp.bonus || 0) + lvl + (mods.stat.hp || 0);
    // PM = Mente + bônus da vocação + bônus manual + nível (+ efeito stat mp)
    const mpMax = a.mente.total + defBonus.mp + (this.resources.mp.bonus || 0) + lvl + (mods.stat.mp || 0);
    // PH = nível (+ efeito stat heroic)
    const heroicMax = lvl + (this.resources.heroic.bonus || 0) + (mods.stat.heroic || 0);

    this.resources.hp.max = hpMax;
    this.resources.mp.max = mpMax;
    this.resources.heroic.max = heroicMax;

    // Clampa atuais ao máximo. Os PV podem ficar NEGATIVOS até -7 (o valor
    // negativo é o dano excedente / nível de ferimento); os demais param em 0.
    this.resources.hp.value = Math.max(DEATH_HP, Math.min(this.resources.hp.value, hpMax));
    this.resources.mp.value = Math.max(0, Math.min(this.resources.mp.value, mpMax));
    this.resources.heroic.value = Math.max(0, Math.min(this.resources.heroic.value, heroicMax));
    this.resources.hp.temp = Math.max(0, this.resources.hp.temp || 0);
  }

  /**
   * @variáveis amigáveis para fórmulas e rolagens inline no chat — ex.:
   * @forca, @nivel, @conjuracao, @pv (ver actorRollData). Mantém também os
   * campos completos do sistema (attributes, resources...) por
   * compatibilidade com caminhos longos. Herdado pelo NPC.
   */
  getRollData() {
    let base = {};
    try { base = this.toObject(false); } catch (e) { base = {}; }
    return { ...base, ...actorRollData(this.parent) };
  }
}

/* ================================================================== */
/*  NPC — mesma ficha do personagem, porém SEM XP                      */
/*  O schema espelha o do personagem (identidade, atributos, recursos, */
/*  bônus, magia), apenas sem o campo details.xp: NPCs não gastam nem  */
/*  ganham XP. prepareDerivedData e migrateData são HERDADOS de        */
/*  PersonagemData, então vocação/raça, efeitos ativos e secundários   */
/*  se comportam exatamente como na ficha de jogador.                  */
/* ================================================================== */
export class NpcData extends PersonagemData {
  static defineSchema() {
    return {
      // Identidade (igual ao personagem, sem o campo xp)
      details: new fields.SchemaField({
        concept: new fields.StringField({ blank: true, initial: "" }),
        race: new fields.StringField({ blank: true, initial: "" }),
        heritage: new fields.StringField({ blank: true, initial: "" }),
        vocation: new fields.StringField({ blank: true, initial: "" }),
        careers: new fields.StringField({ blank: true, initial: "" }),
        nation: new fields.StringField({ blank: true, initial: "" }),
        organizations: new fields.StringField({ blank: true, initial: "" }),
        // NPCs podem passar do nível 6 (sem máximo)
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        corruption: new fields.NumberField({ initial: 0, integer: true }),
        personality: new fields.HTMLField({ blank: true, initial: "" }),
        notes: new fields.HTMLField({ blank: true, initial: "" }),
      }),

      // Condições ativas (lista de ids; ver CONFIG.LIGEIA.conditions)
      conditions: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),

      // Efeitos aplicados diretamente na ficha (buffs/debuffs)
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

      // Este NPC é um INIMIGO? (padrão: sim). Fonte da verdade ABSOLUTA dos
      // filtros de área "só aliados/só inimigos": marcado = lado inimigo;
      // desmarcado = lado aliado — independente de quem conjura e da
      // disposição do token. Personagens contam sempre como aliados.
      isEnemy: new fields.BooleanField({ initial: true }),

      // NPCs rolam ocultamente por padrão
      rollHidden: new fields.BooleanField({ initial: true }),
      // Não abrir a caixa de configuração antes das rolagens deste ator.
      skipRollDialog: new fields.BooleanField({ initial: false }),
    };
  }
}


/* ================================================================== */
/*  VEÍCULO — mesma ficha, SEM a mecânica de categorias de tamanho     */
/*  Herda tudo do NPC (inclusive não usar XP). A única diferença é que */
/*  o tamanho fica neutro: nenhuma categoria, nenhum efeito de tamanho */
/*  aplicado, nenhum bônus de dano de arma nem alcance corpo a corpo   */
/*  por tamanho, e o token não é redimensionado automaticamente.       */
/* ================================================================== */
export class VeiculoData extends NpcData {
  prepareDerivedData() {
    super.prepareDerivedData();
    // Desfaz o que a categoria de tamanho havia somado e zera o estado.
    const s = this.size || {};
    if (s.move) this.secondary.deslocamento -= s.move;
    if (s.hpMod) this.resources.hp.max -= s.hpMod;
    this.size = {
      key: null, label: "", move: 0, hpMod: 0, weaponBonus: 0, reach: 0,
      token: 1, base: null, changed: false, disabled: true,
    };
  }
}
