/**
 * DataModels dos Items do sistema Ligeia.
 * Foundry V13 — foundry.abstract.TypeDataModel
 */
import { activatableFields, effectField, costField, actionsField, migrateFlatActionToArray, migrateEffectTargets } from "./fields.mjs";

const fields = foundry.data.fields;

/* ------------------------------------------------------------------ */
/*  Slots de ficha técnica (alvo, área, alcance, duração)              */
/* ------------------------------------------------------------------ */
function slotFields() {
  return {
    target: new fields.StringField({ blank: true, initial: "" }),
    area: new fields.StringField({ blank: true, initial: "" }),
    range: new fields.StringField({ blank: true, initial: "" }),
    duration: new fields.StringField({ blank: true, initial: "" }),
  };
}

/* ================================================================== */
/*  HABILIDADE                                                         */
/* ================================================================== */
export class HabilidadeData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // Nível atual da habilidade adquirido pelo personagem
      level: new fields.StringField({
        required: true,
        initial: "B",
        choices: ["B", "A", "E"],
      }),
      // Custo de XP por nível (0 = usa a tabela padrão do sistema).
      // O custo efetivo dobra se a habilidade não estiver nas listas de
      // acesso do personagem.
      costBasic: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      costAdvanced: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      costSpecial: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      // Pré-requisito textual (ex: "Mente 4+")
      prereq: new fields.StringField({ blank: true, initial: "" }),
      // Listas a que pertence (texto livre separado por vírgula)
      lists: new fields.StringField({ blank: true, initial: "" }),
      // Ativação (Ação, Reação, etc.)
      activation: new fields.StringField({ blank: true, initial: "" }),
      ...slotFields(),
      // Descrições por nível
      descBasic: new fields.HTMLField({ blank: true, initial: "" }),
      descAdvanced: new fields.HTMLField({ blank: true, initial: "" }),
      descSpecial: new fields.HTMLField({ blank: true, initial: "" }),
      actions: actionsField(),
      ...activatableFields(),
    };
  }
  static migrateData(source) {
    return migrateFlatActionToArray(migrateEffectTargets(super.migrateData(source)));
  }
}

/* ================================================================== */
/*  COMPLICAÇÃO                                                        */
/*  Funciona como uma habilidade, mas em vez de CUSTAR XP ela CONCEDE  */
/*  XP ao personagem (somado ao disponível para gastar em habilidades).*/
/* ================================================================== */
export class ComplicacaoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // Nível/severidade da complicação (mesma escala das habilidades)
      level: new fields.StringField({
        required: true,
        initial: "B",
        choices: ["B", "A", "E"],
      }),
      // XP CONCEDIDO por nível (0 = usa a tabela padrão do sistema,
      // CONFIG.LIGEIA.complicationXp).
      xpBasic: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      xpAdvanced: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      xpSpecial: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      // Pré-requisito textual (ex: "Mente 4+")
      prereq: new fields.StringField({ blank: true, initial: "" }),
      // Listas a que pertence (texto livre separado por vírgula)
      lists: new fields.StringField({ blank: true, initial: "" }),
      // Ativação (Ação, Reação, etc.) — se a complicação tiver uso ativo
      activation: new fields.StringField({ blank: true, initial: "" }),
      ...slotFields(),
      // Descrições por nível
      descBasic: new fields.HTMLField({ blank: true, initial: "" }),
      descAdvanced: new fields.HTMLField({ blank: true, initial: "" }),
      descSpecial: new fields.HTMLField({ blank: true, initial: "" }),
      actions: actionsField(),
      ...activatableFields(),
    };
  }
  static migrateData(source) {
    return migrateFlatActionToArray(migrateEffectTargets(super.migrateData(source)));
  }
}

/* ================================================================== */
/*  MAGIA                                                              */
/* ================================================================== */
export class MagiaData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // Palavra arcana principal (id, ex: "ignis")
      wordId: new fields.StringField({ blank: true, initial: "" }),
      // Círculo: Menor / Intermediária / Maior
      tier: new fields.StringField({
        required: true,
        initial: "Menor",
        choices: ["Menor", "Intermediária", "Maior"],
      }),
      // Conjuração (tempo de conjurar)
      casting: new fields.StringField({ blank: true, initial: "" }),
      ...slotFields(),
      description: new fields.HTMLField({ blank: true, initial: "" }),
      peculiarities: new fields.HTMLField({ blank: true, initial: "" }),
      // Metamagias: lista de { name, wordId, description }
      metamagics: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ blank: true, initial: "" }),
          wordId: new fields.StringField({ blank: true, initial: "" }),
          description: new fields.StringField({ blank: true, initial: "" }),
        }),
      ),
      actions: actionsField(),
      ...activatableFields(),
    };
  }
  static migrateData(source) {
    return migrateFlatActionToArray(migrateEffectTargets(super.migrateData(source)));
  }
}

/* ================================================================== */
/*  EQUIPAMENTO                                                        */
/* ================================================================== */
export class EquipamentoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      category: new fields.StringField({ blank: true, initial: "" }),
      qty: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      weight: new fields.NumberField({ initial: 0, min: 0 }),
      price: new fields.StringField({ blank: true, initial: "" }),
      notes: new fields.StringField({ blank: true, initial: "" }),
      description: new fields.HTMLField({ blank: true, initial: "" }),
      actions: actionsField(),
      ...activatableFields(),
    };
  }
  static migrateData(source) {
    return migrateFlatActionToArray(migrateEffectTargets(super.migrateData(source)));
  }
}

/* ================================================================== */
/*  TRAÇO                                                              */
/* ================================================================== */
export class TracoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // Origem: race, heritage, background, other
      source: new fields.StringField({ blank: true, initial: "other" }),
      description: new fields.HTMLField({ blank: true, initial: "" }),
      // Traços também podem permitir ataque
      isWeapon: new fields.BooleanField({ initial: false }),
      actions: actionsField(),
      ...activatableFields(),
    };
  }
  static migrateData(source) {
    return migrateFlatActionToArray(migrateEffectTargets(super.migrateData(source)));
  }
}

/* ================================================================== */
/*  DEFINIÇÕES (raça, herança, vocação, organização)                   */
/*  Cada uma carrega uma lista de habilidades concedidas.              */
/* ================================================================== */
function definitionBaseFields() {
  return {
    description: new fields.HTMLField({ blank: true, initial: "" }),
    // Lista de nomes de habilidades que a definição concede (custo normal)
    skillList: new fields.ArrayField(new fields.StringField({ blank: true })),
    // Traços concedidos automaticamente quando a definição é adicionada a
    // um personagem. Guardamos os dados essenciais para recriar o Item-traço
    // embutido (nome, descrição, efeitos, etc.).
    grantedTraits: new fields.ArrayField(
      new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: false }),
        img: new fields.StringField({ blank: true, initial: "icons/svg/aura.svg" }),
        // Snapshot do system do traço (description, source, mode, effects,
        // costs, isWeapon, attack). Objeto livre para flexibilidade.
        system: new fields.ObjectField({}),
        // Referência opcional ao traço original (uuid do compêndio/mundo)
        sourceUuid: new fields.StringField({ blank: true, initial: "" }),
      }),
    ),
  };
}

export class RacaData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...definitionBaseFields(),
      // Bônus de deslocamento concedido pela raça
      moveBonus: new fields.NumberField({ initial: 0, integer: true }),
    };
  }
}

export class HerancaData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { ...definitionBaseFields() };
  }
}

export class VocacaoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...definitionBaseFields(),
      // Bônus de PV e PM concedidos pela vocação
      hpBonus: new fields.NumberField({ initial: 0, integer: true }),
      mpBonus: new fields.NumberField({ initial: 0, integer: true }),
    };
  }
}

export class OrganizacaoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { ...definitionBaseFields() };
  }
}

export class CarreiraData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { ...definitionBaseFields() };
  }
}
