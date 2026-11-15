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
      // Palavras arcanas da magia. Quantas valem depende do círculo:
      // Menor = 1, Intermediária = 2, Maior = 3 (ver arcaneWordsOf).
      wordId: new fields.StringField({ blank: true, initial: "" }),
      wordId2: new fields.StringField({ blank: true, initial: "" }),
      wordId3: new fields.StringField({ blank: true, initial: "" }),
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
      // TIPAGENS da arma (grupos e propriedades do livro, mais as que você
      // inventar). Diferente das palavras arcanas, que têm teto por círculo,
      // uma arma carrega quantas quiser.
      //
      // Guarda o id do livro ("duas_maos") para as de lá, e o texto digitado
      // ("Forja Anã") para as inventadas — assim a grafia sobrevive. A
      // comparação é sempre pela forma normalizada (ver weaponTagId).
      tags: new fields.ArrayField(new fields.StringField({ blank: true }), { initial: [] }),
      // LEGADO: antes as tipagens inventadas moravam aqui, separadas por
      // vírgula, num campo à parte. Hoje entram direto em `tags` pelo campo
      // de etiquetas. O campo fica para migrar fichas antigas (migrateData
      // abaixo o esvazia) e não aparece mais na ficha.
      tagsExtra: new fields.StringField({ blank: true, initial: "" }),
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
    return migrateFlatActionToArray(migrateEffectTargets(migrateWeaponTags(super.migrateData(source))));
  }
}

/**
 * MIGRAÇÃO das tipagens de arma: as que moravam no campo de texto separado
 * por vírgula (`tagsExtra`) passam a ser etiquetas normais em `tags`.
 * Preserva a grafia digitada e não duplica o que já está marcado.
 */
function migrateWeaponTags(source) {
  if (!source || typeof source !== "object") return source;
  const extra = String(source.tagsExtra || "").trim();
  if (!extra) return source;
  const tags = Array.isArray(source.tags) ? [...source.tags] : [];
  const normal = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase().replace(/\s+/g, "_");
  const vistos = new Set(tags.map(normal));
  for (const bruto of extra.split(",")) {
    const texto = bruto.trim();
    const id = normal(texto);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    tags.push(texto);
  }
  source.tags = tags;
  source.tagsExtra = "";
  return source;
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
      // Categoria de tamanho da raça: define o TAMANHO INICIAL do personagem
      // e, por ele, o deslocamento base (coluna bípede da tabela).
      size: new fields.StringField({ blank: true, initial: "medio" }),
      // Ajuste de deslocamento por cima do que o tamanho já concede
      moveBonus: new fields.StringField({ blank: true, initial: "0" }),
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
      // Aceitam fórmula com @variáveis, como os demais campos numéricos.
      hpBonus: new fields.StringField({ blank: true, initial: "0" }),
      mpBonus: new fields.StringField({ blank: true, initial: "0" }),
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
