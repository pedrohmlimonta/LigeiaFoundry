/**
 * Campos de dados reutilizáveis entre os modelos de Item.
 * Foundry V13 — usa foundry.data.fields.
 */
const fields = foundry.data.fields;

/**
 * Um efeito mecânico que um item pode conceder quando ativo.
 * Tipos: dice (+dados melhoria), bonus (+rolagem), stat (modifica valor),
 *        set (define valor fixo), damage, rd (redução de dano), tempHp
 *        (sobrevida concedida ao ativar o item), areaFilter (força as áreas
 *        do personagem a afetar só aliados/só inimigos), info (condição).
 */
export function effectField() {
  return new fields.ArrayField(
    new fields.SchemaField({
      type: new fields.StringField({
        required: true,
        initial: "bonus",
        choices: ["dice", "bonus", "stat", "set", "damage", "rd", "reroll1", "reroll6", "crit", "fumble", "tempHp", "areaFilter", "info"],
      }),
      target: new fields.StringField({ required: true, initial: "all" }),
      value: new fields.NumberField({ required: true, initial: 0, integer: true }),
      // Para reroll1/reroll6: se true, rerrola TODOS os dados que caírem no
      // valor alvo (ignora "value"). Senão, rerrola até "value" dados.
      rerollAll: new fields.BooleanField({ required: false, initial: false }),
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
    // Por padrão os itens são ATIVÁVEIS (precisam ser ligados para valer) e
    // começam desligados (active=false). Use "passive" para efeitos sempre-on.
    mode: new fields.StringField({
      required: true,
      initial: "active",
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
 *    Modos COMPOSTOS ("area:all|allies|enemies", "aura:...") vêm do seletor
 *    da UI e são divididos na leitura em targetMode + areaFilter (ver
 *    normalizeCompositeTargetModes) — o resto do sistema só vê os simples.
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
    // Rolagem contra dificuldade FIXA (CD). Pode coexistir com a rolagem de
    // ataque: quando ambas ativas, a ação precisa superar a defesa do alvo E
    // a CD fixa. Quando só esta está ativa, basta superar a CD.
    vsDifficulty: new fields.BooleanField({ initial: false }),
    fixedDifficulty: new fields.NumberField({ initial: 8, integer: true, min: 0 }),
    // Atributo do ALVO somado à dificuldade fixa (a CD efetiva = CD fixa +
    // atributo do alvo). "nenhum" = não soma nada. Inclui especiais
    // (conjuração, iniciativa, esquiva, bloqueio) e os primários.
    difficultyAttr: new fields.StringField({ blank: true, initial: "nenhum" }),
    targetMode: new fields.StringField({
      required: true,
      initial: "target",
      choices: [
        "none", "self", "target", "area", "aura",
        // Compostos vindos do seletor da UI (divididos pelo migrateData):
        "area:all", "area:allies", "area:enemies",
        "aura:all", "aura:allies", "aura:enemies",
      ],
    }),
    includeSelf: new fields.BooleanField({ initial: false }),
    // Filtro de alvos para ÁREA/AURA: todos, só aliados ou só inimigos.
    // Aliado = token com a MESMA disposição do conjurador; inimigo =
    // disposição oposta (amistoso ↔ hostil; conjurador neutro trata
    // não-neutros como inimigos). O próprio conjurador conta como aliado.
    areaFilter: new fields.StringField({
      required: false,
      initial: "all",
      choices: ["all", "allies", "enemies"],
    }),
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
    // --- CURA (recuperação de vida/recurso) ---
    // Fórmula de cura aplicada a cada afetado quando a ação "acerta" (em
    // self/aliados sem teste, aplica automaticamente). Recupera o recurso
    // escolhido, limitado ao máximo da ficha. Cura ignora RD e os
    // multiplicadores de condição de dano.
    heal: new fields.StringField({ blank: true, initial: "" }),
    healResource: new fields.StringField({
      required: false,
      initial: "hp",
      choices: ["hp", "mp", "heroic", "hpTemp"],
    }),
    // Cura ESCALONADA: como o dano escalonado, soma +1 por 2 pontos pelos
    // quais a rolagem superou o teste que se aplicou (defesa do alvo e/ou
    // CD efetiva — o mais alto entre eles).
    scalingHeal: new fields.BooleanField({ initial: false }),
    // Quando a cura vai para SOBREVIDA (healResource "hpTemp"): se true,
    // SOMA à sobrevida atual; se false (padrão), fica apenas o MAIOR valor
    // entre a atual e a concedida (sobrevida não acumula).
    tempStack: new fields.BooleanField({ initial: false }),
    // Não abrir a caixa de rolagem ao executar esta ação. Ligado por padrão:
    // nas ações a rolagem já vem planejada.
    skipRollDialog: new fields.BooleanField({ initial: true }),
    // Dano EXTRA: parcelas adicionais de dano, cada uma com sua fórmula e tipo
    // (podem repetir o tipo ou variar). Aplicadas junto do dano principal ao
    // acertar. Não recebem o escalonamento (esse é só do dano principal).
    extraDamage: new fields.ArrayField(
      new fields.SchemaField({
        formula: new fields.StringField({ blank: true, initial: "" }),
        type: new fields.StringField({ blank: true, initial: "" }),
        resource: new fields.StringField({ initial: "hp", choices: ["hp", "mp", "heroic"] }),
        // Se esta parcela extra também recebe o dano escalonado (bônus por
        // superar a defesa). Independente do escalonamento do dano principal.
        scaling: new fields.BooleanField({ initial: false }),
      }),
      { initial: [] },
    ),
    // Efeito de MOVIMENTO: teleporta, empurra, puxa, desloca lateralmente ou
    // reposiciona (telecinese) o alvo ou o próprio conjurador. Aciona sob as
    // mesmas regras da ação (CD fixa / resistida / ambas / automático).
    movement: new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      kind: new fields.StringField({
        initial: "push",
        choices: ["teleport", "push", "pull", "lateral", "place"],
      }),
      who: new fields.StringField({ initial: "targets", choices: ["self", "targets"] }),
      // Distância em metros. Em teleporte/telecinese, 0 = sem limite.
      distance: new fields.NumberField({ initial: 0, min: 0 }),
      lateralSide: new fields.StringField({ initial: "right", choices: ["left", "right"] }),
      // Ignora paredes (sempre verdadeiro no teleporte).
      ignoreWalls: new fields.BooleanField({ initial: false }),
      // Encaixa o destino no centro da casa do grid.
      snap: new fields.BooleanField({ initial: true }),
    }),
    // Efeitos aplicados ao ALVO quando a ação acerta. Cada um é como um
    // efeito de habilidade (qualquer tipo, incluindo "condition") e vira um
    // "efeito ativo" na ficha do alvo, com duração e resistência por rodada.
    appliesEffects: new fields.ArrayField(
      new fields.SchemaField({
        label: new fields.StringField({ blank: true, initial: "Efeito" }),
        // Tipo do modificador (mesma lista dos efeitos de itens + condição)
        fxType: new fields.StringField({
          initial: "bonus",
          choices: ["bonus", "dice", "stat", "set", "damage", "rd", "reroll1", "reroll6", "crit", "fumble", "restore", "condition"],
        }),
        // Alvo do modificador — depende do tipo (atributo, recurso, tipo de
        // dano ou id de condição). Sempre escolhido por select.
        fxTarget: new fields.StringField({ blank: true, initial: "all" }),
        fxValue: new fields.NumberField({ initial: 0, integer: true }),
        // Para reroll: se true, rerrola TODOS os dados no valor alvo.
        fxAll: new fields.BooleanField({ initial: false }),
        // Duração: "rounds" (em rodadas) ou "scene" (até o fim da cena)
        durationMode: new fields.StringField({ initial: "scene", choices: ["rounds", "scene"] }),
        durationRounds: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        // Resistência por rodada
        resist: new fields.BooleanField({ initial: false }),
        resistAttr: new fields.StringField({ blank: true, initial: "vigor" }),
        resistVsCast: new fields.BooleanField({ initial: true }),
        resistDc: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        // Quando true, a CD do teste de resistência é REFEITA a cada rodada:
        // o atacante rola o atributo do ataque de novo (rolagem resistida
        // fresca, ignorando alcance) para gerar a nova CD.
        resistReroll: new fields.BooleanField({ initial: false }),
        // Dano contínuo por rodada (0 = nenhum) — ex.: Corrosão
        tickAmount: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        tickType: new fields.StringField({ blank: true, initial: "" }),
        tickResource: new fields.StringField({ initial: "hp", choices: ["hp", "mp", "heroic"] }),
        // REGENERAÇÃO por rodada (0 = nenhuma): recupera o recurso no início
        // dos turnos do portador enquanto o efeito durar (contraparte do
        // dano contínuo acima).
        tickHealAmount: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        tickHealResource: new fields.StringField({ initial: "hp", choices: ["hp", "mp", "heroic"] }),
        // SOBREVIDA VINCULADA (barreira): concede N de sobrevida ao aplicar.
        // O efeito e a sobrevida vivem e morrem juntos: sobrevida zerou →
        // o efeito termina; efeito terminou → a sobrevida some.
        grantTempHp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      }),
      { initial: [] },
    ),
    range: new fields.NumberField({ initial: 0, integer: false, min: 0 }),
    area: new fields.NumberField({ initial: 0, integer: false, min: 0 }),
    // Macro executada ao rodar a ação (arrastada para o editor). Pode ser
    // ligada/desligada sem remover. Guarda também o nome para exibição.
    macroUuid: new fields.StringField({ blank: true, initial: "" }),
    macroName: new fields.StringField({ blank: true, initial: "" }),
    macroEnabled: new fields.BooleanField({ initial: true }),
    // Animação PRÓPRIA da ação (Automated Animations) — legado (capturada do
    // item). Mantida por compatibilidade; o editor usa os campos anim* abaixo.
    aaConfig: new fields.ObjectField({ required: false, nullable: true, initial: null }),
    aaName: new fields.StringField({ blank: true, initial: "" }),
    aaEnabled: new fields.BooleanField({ initial: true }),
    // Animação por ação via Sequencer (independente entre ações do mesmo item).
    // animFile: caminho do efeito (base de dados do Sequencer, ex.
    //   "jb2a.fireball.explosion.orange", ou uma URL de arquivo).
    animFile: new fields.StringField({ blank: true, initial: "" }),
    // Onde tocar: "cast" (no conjurador), "target" (em cada alvo),
    // "ranged" (projétil do conjurador até cada alvo).
    animPlacement: new fields.StringField({
      initial: "target",
      choices: ["cast", "target", "ranged"],
    }),
    animScale: new fields.NumberField({ initial: 1, min: 0.1 }),
    animEnabled: new fields.BooleanField({ initial: true }),
    // Prende o efeito ao token (acompanha o movimento). Ações que MOVEM
    // tokens já prendem automaticamente; isto força também nas demais.
    animAttach: new fields.BooleanField({ initial: false }),
    // Custo da ação ao ser executada (descontado do personagem). 0 = grátis.
    costMp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    costHp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    costHeroic: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    // --- Área/aura PERSISTENTE (emanação) ---
    // Quando a ação é de área ou aura, ela pode deixar a área no canvas por
    // uma duração. Enquanto ativa, todo token que INICIAR o turno dentro da
    // área refaz a rolagem/efeito da ação automaticamente (emanação contínua).
    persistArea: new fields.BooleanField({ initial: false }),
    // Duração da emanação: número de rodadas, ou 0 = até o fim da cena.
    persistRounds: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
    // Se a área deve afetar também quem a criou ao iniciar o turno dentro dela.
    persistAffectsSelf: new fields.BooleanField({ initial: false }),
    // Se true, a rolagem de ataque é REFEITA a cada disparo; se false, usa o
    // total do ataque rolado na criação (congelado) como CD fixa.
    persistRerollAttack: new fields.BooleanField({ initial: false }),
    // Quando a emanação afeta um personagem: ao INICIAR o turno dentro
    // ("turn"), ao ENTRAR na área ("enter"), ou em ambos ("both").
    persistTrigger: new fields.StringField({
      initial: "both",
      choices: ["turn", "enter", "both"],
    }),
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
  if (Array.isArray(source.actions) && source.actions.length) {
    return normalizeCompositeTargetModes(source);
  }
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
    extraDamage: Array.isArray(source.extraDamage) ? source.extraDamage : [],
    range: 0,
    area: 0,
  }];
  return normalizeCompositeTargetModes(source);
}

/**
 * Divide modos de alvo COMPOSTOS ("area:enemies", "aura:allies", "area:all")
 * vindos do seletor da UI nos dois campos que o resto do sistema entende:
 * targetMode ("area"/"aura") + areaFilter ("all"/"allies"/"enemies").
 * Escolher a opção simples ("area:all") também RESETA o filtro para "all",
 * garantindo que o seletor sempre reflita o estado salvo.
 */
export function normalizeCompositeTargetModes(source) {
  if (!source || !Array.isArray(source.actions)) return source;
  for (const a of source.actions) {
    if (typeof a?.targetMode === "string" && a.targetMode.includes(":")) {
      const [m, f] = a.targetMode.split(":");
      a.targetMode = m;
      if (f === "all" || f === "allies" || f === "enemies") a.areaFilter = f;
    }
  }
  return source;
}
