/**
 * Campos de dados reutilizáveis entre os modelos de Item.
 * Foundry V13 — usa foundry.data.fields.
 */
const fields = foundry.data.fields;

/**
 * Um efeito mecânico que um item pode conceder quando ativo.
 * Tipos: dice (+dados melhoria), bonus (+rolagem), stat (modifica valor),
 *        set (define valor fixo), damage, rd (redução de dano), info (condição).
 */
export function effectField() {
  return new fields.ArrayField(
    new fields.SchemaField({
      type: new fields.StringField({
        required: true,
        initial: "bonus",
        choices: ["dice", "bonus", "stat", "set", "damage", "rd", "info"],
      }),
      target: new fields.StringField({ required: true, initial: "all" }),
      value: new fields.NumberField({ required: true, initial: 0, integer: true }),
      label: new fields.StringField({ required: false, blank: true, initial: "" }),
      enabled: new fields.BooleanField({ initial: true }),
      // Nível em que o efeito passa a valer (SÓ habilidades usam isto):
      //   "all" = sempre; "B" = a partir de Básico; "A" = a partir de
      //   Avançado; "E" = só no Épico/Especial.
      // Para outros tipos de item, fica "all" e é ignorado.
      level: new fields.StringField({
        required: false,
        initial: "all",
        choices: ["all", "B", "A", "E"],
      }),
      // Tipo de dano (só relevante para type "damage" e "rd").
      //   "" / "all" = aplica a qualquer tipo de dano.
      //   Caso contrário, restringe ao tipo (ex.: rd "fogo" só reduz fogo).
      damageType: new fields.StringField({ required: false, blank: true, initial: "" }),
    }),
  );
}

/**
 * Um custo de recurso (mp, hp, hpTemp, heroic) para ativar/usar um item.
 */
export function costField() {
  return new fields.ArrayField(
    new fields.SchemaField({
      resource: new fields.StringField({
        required: true,
        initial: "mp",
        choices: ["mp", "hp", "hpTemp", "heroic"],
      }),
      value: new fields.NumberField({ required: true, initial: 0, integer: true }),
      label: new fields.StringField({ required: false, blank: true, initial: "" }),
    }),
  );
}

/**
 * Campos comuns a itens "ativáveis" (passivo/ativo + efeitos + custos).
 */
export function activatableFields() {
  return {
    mode: new fields.StringField({
      required: true,
      initial: "passive",
      choices: ["passive", "active"],
    }),
    active: new fields.BooleanField({ initial: false }),
    effects: effectField(),
    costs: costField(),
  };
}

/**
 * Campos de AÇÃO/ROLAGEM comuns a itens que podem rolar e atacar
 * (habilidade, magia, equipamento, traço).
 *
 *  - canRoll: se a ação dispara uma rolagem ao ser clicada.
 *  - rollAttr: atributo do ATACANTE usado na rolagem (força…esquiva).
 *  - rollBonus / rollDice: bônus plano e dados de melhoria extras.
 *  - hasTarget: se a ação exige rolagem de DEFESA do alvo.
 *  - defenseAttr: atributo de DEFESA que o alvo rola (esquiva…percepção).
 *  - damage / damageType: fórmula de dano e o tipo (corte, fogo, …).
 *    O dano só é aplicado/sugerido se houver dano definido.
 */
/**
 * UMA entrada de ação. Um item pode ter VÁRIAS (array actionsField).
 * Cada ação tem sua própria rolagem, alvo, área/alcance, dano e condições.
 *
 *  targetMode:
 *    "none"   — sem alvo (só uma rolagem e/ou dano anunciado)
 *    "self"   — afeta o próprio personagem (sem defesa)
 *    "target" — afeta o(s) alvo(s) mirados (com defesa, se canRoll)
 *    "area"   — área centrada no personagem; inclui ele por padrão (includeSelf)
 *    "aura"   — aura centrada no personagem; NÃO o inclui por padrão
 *
 *  includeSelf: força incluir/excluir o próprio personagem em area/aura.
 *  range/area: alcance e raio em metros (informativo + usado no resumo).
 */
export function actionEntryField() {
  return new fields.SchemaField({
    label: new fields.StringField({ blank: true, initial: "Ação" }),
    canRoll: new fields.BooleanField({ initial: true }),
    rollAttr: new fields.StringField({ blank: true, initial: "forca" }),
    rollBonus: new fields.NumberField({ initial: 0, integer: true }),
    rollDice: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    targetMode: new fields.StringField({
      required: true,
      initial: "target",
      choices: ["none", "self", "target", "area", "aura"],
    }),
    includeSelf: new fields.BooleanField({ initial: false }),
    defenseAttr: new fields.StringField({ blank: true, initial: "esquiva" }),
    defenseAttr2: new fields.StringField({ blank: true, initial: "" }),
    damage: new fields.StringField({ blank: true, initial: "" }),
    damageType: new fields.StringField({ blank: true, initial: "" }),
    damageResource: new fields.StringField({
      required: false,
      initial: "hp",
      choices: ["hp", "mp", "heroic"],
    }),
    scalingDamage: new fields.BooleanField({ initial: false }),
    // Efeitos aplicados ao ALVO quando a ação acerta. Cada um é como um
    // efeito de habilidade (qualquer tipo, incluindo "condition") e vira um
    // "efeito ativo" na ficha do alvo, com duração e resistência por rodada.
    appliesEffects: new fields.ArrayField(
      new fields.SchemaField({
        label: new fields.StringField({ blank: true, initial: "Efeito" }),
        // Tipo do modificador (mesma lista dos efeitos de itens + condição)
        fxType: new fields.StringField({
          initial: "bonus",
          choices: ["bonus", "dice", "stat", "set", "damage", "rd", "condition"],
        }),
        // Alvo do modificador — depende do tipo (atributo, recurso, tipo de
        // dano ou id de condição). Sempre escolhido por select.
        fxTarget: new fields.StringField({ blank: true, initial: "all" }),
        fxValue: new fields.NumberField({ initial: 0, integer: true }),
        // Duração: "rounds" (em rodadas) ou "scene" (até o fim da cena)
        durationMode: new fields.StringField({ initial: "scene", choices: ["rounds", "scene"] }),
        durationRounds: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        // Resistência por rodada
        resist: new fields.BooleanField({ initial: false }),
        resistAttr: new fields.StringField({ blank: true, initial: "vigor" }),
        resistVsCast: new fields.BooleanField({ initial: true }),
        resistDc: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        // Dano contínuo por rodada (0 = nenhum) — ex.: Corrosão
        tickAmount: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        tickType: new fields.StringField({ blank: true, initial: "" }),
        tickResource: new fields.StringField({ initial: "hp", choices: ["hp", "mp", "heroic"] }),
      }),
      { initial: [] },
    ),
    range: new fields.NumberField({ initial: 0, integer: false, min: 0 }),
    area: new fields.NumberField({ initial: 0, integer: false, min: 0 }),
    // Custo da ação ao ser executada (descontado do personagem). 0 = grátis.
    costMp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    costHp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    costHeroic: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
  });
}

/** Lista de ações de um item. */
export function actionsField() {
  return new fields.ArrayField(actionEntryField(), { initial: [] });
}

/**
 * MIGRAÇÃO: corrige nomes de alvo de efeito que mudaram (inglês/antigos →
 * português/atuais), para que os modificadores voltem a ser reconhecidos.
 */
const EFFECT_TARGET_RENAMES = {
  initiative: "iniciativa",
  max_hp: "hp",
  max_mp: "mp",
  max_heroic: "heroic",
  defense: "defense", // mantém (categoria geral)
};
export function migrateEffectTargets(source) {
  if (!source || typeof source !== "object") return source;
  const fix = (list) => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      if (e && e.target && EFFECT_TARGET_RENAMES[e.target]) {
        e.target = EFFECT_TARGET_RENAMES[e.target];
      }
    }
  };
  fix(source.effects);
  // efeitos dentro de appliedEffects (atores)
  if (Array.isArray(source.appliedEffects)) {
    for (const ae of source.appliedEffects) fix(ae?.effects);
  }
  return source;
}

/**
 * Wrapper de MIGRAÇÃO: converte os campos planos de ação antigos (canRoll,
 * rollAttr, hasTarget, damage, etc. no nível system) em uma única entrada
 * no novo array system.actions, quando este ainda não existir.
 * Deve ser chamado de static migrateData(source) de cada item.
 */
export function migrateFlatActionToArray(source) {
  if (!source || typeof source !== "object") return source;
  if (Array.isArray(source.actions) && source.actions.length) return source;
  const hasLegacy =
    "canRoll" in source || "rollAttr" in source || "hasTarget" in source ||
    "damage" in source;
  if (!hasLegacy) return source;

  const legacyTargetMode = source.hasTarget ? "target" : "none";
  source.actions = [{
    label: "Ação",
    canRoll: source.canRoll ?? true,
    rollAttr: source.rollAttr ?? "forca",
    rollBonus: source.rollBonus ?? 0,
    rollDice: source.rollDice ?? 0,
    targetMode: legacyTargetMode,
    includeSelf: false,
    defenseAttr: source.defenseAttr ?? "esquiva",
    defenseAttr2: source.defenseAttr2 ?? "",
    damage: source.damage ?? "",
    damageType: source.damageType ?? "",
    damageResource: source.damageResource ?? "hp",
    scalingDamage: source.scalingDamage ?? false,
    range: 0,
    area: 0,
  }];
  return source;
}
