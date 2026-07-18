/**
 * Ligeia RPG — Sistema para Foundry VTT V13
 * Ponto de entrada (ES module).
 */
import { LigeiaActor } from "./documents/actor.mjs";
import { LigeiaItem } from "./documents/item.mjs";
import { LigeiaCombatant } from "./documents/combatant.mjs";
import { LigeiaCharacterSheet } from "./sheets/character-sheet.mjs";
// Ficha alternativa "Elegante" (abas + barras + favoritos). Agora parte do
// sistema: importar aqui faz ela se registrar (init) e pré-carregar partials.
import "./sheets/ficha-elegante.mjs";
import { registerEmanationHooks } from "./helpers/emanation.mjs";
import { registerTokenRuler } from "./helpers/token-ruler.mjs";
import { registerMovementHooks, registerMovementSocket, registerForcedMovementActions } from "./helpers/movement.mjs";
import { registerTurnEffectHooks } from "./helpers/turn-effects.mjs";
import { registerBarrierHooks } from "./helpers/barrier.mjs";
import { applyTempHpToActor } from "./helpers/dice.mjs";
import { activeEffectsOf } from "./helpers/effects.mjs";
import {
  HabilidadeSheet,
  ComplicacaoSheet,
  MagiaSheet,
  EquipamentoSheet,
  TracoSheet,
  DefinicaoSheet,
} from "./sheets/item-sheets.mjs";
import { PersonagemData, NpcData } from "./data/actor-data.mjs";
import {
  HabilidadeData,
  ComplicacaoData,
  MagiaData,
  EquipamentoData,
  TracoData,
  RacaData,
  HerancaData,
  VocacaoData,
  OrganizacaoData,
  CarreiraData,
} from "./data/item-data.mjs";

/* ------------------------------------------------------------------ */
/*  INIT                                                               */
/* ------------------------------------------------------------------ */
Hooks.once("init", function () {
  console.log("Ligeia RPG | Inicializando sistema");

  // Namespace global para debug/macros
  game.ligeia = {
    LigeiaActor,
    LigeiaItem,
  };

  // Configuração de iniciativa padrão (2d6 + iniciativa)
  CONFIG.Combat.initiative = {
    formula: "2d6 + @secondary.iniciativa",
    decimals: 0,
  };

  // Classes de documento
  CONFIG.Actor.documentClass = LigeiaActor;
  CONFIG.Item.documentClass = LigeiaItem;
  CONFIG.Combatant.documentClass = LigeiaCombatant;

  // Rastro de movimento colorido pelo Deslocamento (verde/amarelo/vermelho).
  registerTokenRuler();
  // Ações de movimento forçado (empurrão/puxão/telecinese) — deslize animado.
  registerForcedMovementActions();

  // DataModels — Actors
  CONFIG.Actor.dataModels = {
    personagem: PersonagemData,
    npc: NpcData,
  };

  // DataModels — Items
  CONFIG.Item.dataModels = {
    habilidade: HabilidadeData,
    complicacao: ComplicacaoData,
    magia: MagiaData,
    equipamento: EquipamentoData,
    traco: TracoData,
    raca: RacaData,
    heranca: HerancaData,
    vocacao: VocacaoData,
    organizacao: OrganizacaoData,
    carreira: CarreiraData,
  };

  // Constantes do sistema (palavras arcanas, custos de XP, etc.)
  CONFIG.LIGEIA = {
    // Custo de XP por nível de habilidade
    skillCost: { B: 20, A: 40, E: 80 },
    // XP CONCEDIDO por nível de complicação (o inverso do custo de
    // habilidade: complicações DÃO XP em vez de gastar)
    complicationXp: { B: 20, A: 40, E: 80 },
    // Multiplicador quando a habilidade está fora das listas conhecidas
    offListMultiplier: 2,
    // 28 palavras arcanas
    arcaneWords: [
      "acida", "augurado", "carmo", "devena", "energio", "exitium",
      "forjuri", "fulgur", "glacios", "ignis", "iluzio", "inanis",
      "kreo", "krucigon", "lumo", "majesto", "menso", "mortis",
      "noxia", "pluribus", "saeculorum", "sangon", "sankta", "sonigu",
      "sorcdiron", "tenebrae", "traumato", "vitae",
    ],
    // Tabela de progressão (XP acumulado necessário por nível) — pág. 249
    xpTable: { 1: 0, 2: 100, 3: 210, 4: 330, 5: 460, 6: 600 },

    // Tipos de dano. A redução de dano (RD) de um tipo reduz apenas o dano
    // daquele tipo.
    // Tipos de dano REDUTÍVEIS (sujeitos à Redução de Dano).
    damageTypes: {
      acido: "Ácido",
      concussao: "Concussão",
      corte: "Corte",
      energia: "Energia",
      fogo: "Fogo",
      frio: "Frio",
      necrotico: "Necrótico",
      perfuracao: "Perfuração",
      psiquico: "Psíquico",
      radiante: "Radiante",
      raio: "Raio",
      sonico: "Sônico",
      veneno: "Veneno",
    },
    // Dano FINAL: não é redutível (ignora Redução de Dano). Fica separado dos
    // tipos acima na escolha do dano a causar.
    finalDamageType: "final",
    finalDamageLabel: "Final",

    // Atributos usáveis como ATAQUE (rolagem do atacante).
    attackAttrs: {
      forca: "Força",
      agilidade: "Agilidade",
      vigor: "Vigor",
      mente: "Mente",
      percepcao: "Percepção",
      conjuracao: "Conjuração",
      bloqueio: "Bloqueio",
      esquiva: "Esquiva",
    },

    // Atributos usáveis como DEFESA (rolagem do alvo).
    defenseAttrs: {
      esquiva: "Esquiva",
      bloqueio: "Bloqueio",
      conjuracao: "Conjuração",
      forca: "Força",
      agilidade: "Agilidade",
      vigor: "Vigor",
      mente: "Mente",
      percepcao: "Percepção",
    },

    // Condições do Livro de Regras (Sessão 14: Combate). Cada uma tem um
    // rótulo, um ícone e uma descrição resumida do efeito.
    conditions: {
      abalado: {
        label: "Abalado",
        icon: "icons/svg/terror.svg",
        desc: "Sente medo de quem causou. Move-se para longe da fonte; não pode se aproximar nem atacá-la. Anula com Mente.",
      },
      agarrado: {
        label: "Agarrado",
        icon: "icons/svg/net.svg",
        desc: "Preso por outra criatura. Fica também Imobilizado e Indefeso. Anula com Força ou Agilidade.",
      },
      atordoado: {
        label: "Atordoado",
        icon: "icons/svg/daze.svg",
        desc: "Sem ciência dos arredores; não recebe ações no turno. Fica também Indefeso. Anula com Mente ou Vigor.",
      },
      caido: {
        label: "Caído",
        icon: "icons/svg/falling.svg",
        desc: "Deitado no chão. Perde 1D em todas as rolagens. Fica também Lento e Indefeso. Levanta usando o movimento.",
      },
      cego: {
        label: "Cego",
        icon: "icons/svg/blind.svg",
        desc: "Sem visão; não escolhe alvos para atacar/conjurar. -1D em rolagens que exijam visão. Fica também Indefeso.",
      },
      dano_continuo: {
        label: "Dano Contínuo",
        icon: "icons/svg/blood.svg",
        desc: "Sofre 1 ponto de dano do tipo especificado no começo de cada turno.",
      },
      dominado: {
        label: "Dominado",
        icon: "icons/svg/eye.svg",
        desc: "Age conforme a vontade de quem dominou; não conjura magias nem usa poderes divinos. Fica também Pasmo. Anula com Mente.",
      },
      enfeiticado: {
        label: "Enfeitiçado",
        icon: "icons/svg/sun.svg",
        desc: "Considera quem enfeitiçou como amigo e o protege. Anula com Mente.",
      },
      enfraquecido: {
        label: "Enfraquecido",
        icon: "icons/svg/downgrade.svg",
        desc: "Causa apenas metade do dano final em ataques e magias. Anula com Mente ou Vigor.",
      },
      exausto: {
        label: "Exausto",
        icon: "icons/svg/unconscious.svg",
        desc: "-1D em todas as rolagens. Fica também Lento. Anula com Mente ou Vigor (não se vier da perda total de PM).",
      },
      imobilizado: {
        label: "Imobilizado",
        icon: "icons/svg/anchor.svg",
        desc: "Incapaz de se mover. Anula com Força ou Vigor.",
      },
      inconsciente: {
        label: "Inconsciente",
        icon: "icons/svg/sleep.svg",
        desc: "Não recebe ações nem realiza reações; fica Indefeso.",
      },
      indefeso: {
        label: "Indefeso",
        icon: "icons/svg/statue.svg",
        desc: "Atacantes têm vantagem. Não pode bloquear e tem -3 em Esquiva. Anula com Mente.",
      },
      intangivel: {
        label: "Intangível",
        icon: "icons/svg/aura.svg",
        desc: "Incorpóreo; recebe metade do dano final. Atravessa objetos. Imune a Lento e Imobilizado.",
      },
      invisivel: {
        label: "Invisível",
        icon: "icons/svg/invisible.svg",
        desc: "Não pode ser vista. Quem não a vê fica indefeso para ela. +1D contra ataques de quem não a vê e em furtividade.",
      },
      lento: {
        label: "Lento",
        icon: "icons/svg/clockwork.svg",
        desc: "Deslocamento reduzido à metade. Anula com Vigor.",
      },
      paralisado: {
        label: "Paralisado",
        icon: "icons/svg/paralysis.svg",
        desc: "Sem ações no começo do turno, mas com ciência total dos arredores. Fica também Indefeso. Anula com Vigor ou Força.",
      },
      pasmo: {
        label: "Pasmo",
        icon: "icons/svg/stoned.svg",
        desc: "Faz apenas uma ação por turno. Anula com Mente.",
      },
      surdo: {
        label: "Surdo",
        icon: "icons/svg/silenced.svg",
        desc: "Não pode ouvir. Perde 1D em rolagens de Conjuração e em rolagens que exijam audição. Salvo indicado, anula com Vigor antes do fim da cena.",
      },
      surpreso: {
        label: "Surpreso",
        icon: "icons/svg/hazard.svg",
        desc: "Ainda não agiu em combate. Ataques contra criaturas surpresas recebem 1D nas rolagens.",
      },
      telecinese: {
        label: "Telecinese",
        icon: "icons/svg/explosion.svg",
        desc: "Sob controle telecinético: não se move por conta própria. Quem o controla o reposiciona; o Mestre pode movê-lo. Sair do efeito devolve o movimento.",
      },
    },
  };

  // ---- Registro de folhas (sheets) ----
  // Foundry V13: foundry.applications.apps.DocumentSheetConfig
  const DSC = foundry.applications.apps.DocumentSheetConfig;

  // A ficha básica continua disponível, mas NÃO é mais a padrão: a "Ficha
  // Elegante" (registrada em ./sheets/ficha-elegante.mjs) é a padrão.
  DSC.registerSheet(Actor, "ligeia-rpg", LigeiaCharacterSheet, {
    types: ["personagem", "npc"],
    makeDefault: false,
    label: "Ligeia — Ficha de Personagem (clássica)",
  });

  // Folhas de Item
  DSC.registerSheet(Item, "ligeia-rpg", HabilidadeSheet, {
    types: ["habilidade"], makeDefault: true, label: "Ligeia — Habilidade",
  });
  DSC.registerSheet(Item, "ligeia-rpg", ComplicacaoSheet, {
    types: ["complicacao"], makeDefault: true, label: "Ligeia — Complicação",
  });
  DSC.registerSheet(Item, "ligeia-rpg", MagiaSheet, {
    types: ["magia"], makeDefault: true, label: "Ligeia — Magia",
  });
  DSC.registerSheet(Item, "ligeia-rpg", EquipamentoSheet, {
    types: ["equipamento"], makeDefault: true, label: "Ligeia — Equipamento",
  });
  DSC.registerSheet(Item, "ligeia-rpg", TracoSheet, {
    types: ["traco"], makeDefault: true, label: "Ligeia — Traço",
  });
  DSC.registerSheet(Item, "ligeia-rpg", DefinicaoSheet, {
    types: ["raca", "heranca", "vocacao", "organizacao", "carreira"],
    makeDefault: true, label: "Ligeia — Definição",
  });

  // ---- Helpers Handlebars ----
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("ne", (a, b) => a !== b);
  Handlebars.registerHelper("lt", (a, b) => a < b);
  Handlebars.registerHelper("gt", (a, b) => a > b);
  Handlebars.registerHelper("or", (...args) => {
    // Último argumento é o objeto de options do Handlebars
    return args.slice(0, -1).some(Boolean);
  });

  console.log("Ligeia RPG | Sistema inicializado (Fase 4: listas e XP)");
});

/* ------------------------------------------------------------------ */
/*  READY                                                              */
/* ------------------------------------------------------------------ */
Hooks.once("ready", function () {
  console.log("Ligeia RPG | Pronto");
  // Ativa as emanações (áreas/auras persistentes com disparo por turno).
  registerEmanationHooks();
  // Rolagens automáticas de fim de efeito no início do turno.
  registerTurnEffectHooks();
  registerBarrierHooks();
  // Efeitos de movimento: trava da Telecinese e receptor de pedidos ao Mestre.
  registerMovementHooks();
  registerMovementSocket();
});

/* ------------------------------------------------------------------ */
/*  Definições únicas: o personagem só pode ter UMA raça, UMA herança, */
/*  UMA vocação e UMA carreira. Organizações são livres.               */
/*  Ao tentar adicionar uma segunda do mesmo tipo, pergunta (Sim/Não)  */
/*  se deseja substituir. Não → mantém a atual e não adiciona.         */
/*  Sim → remove a atual e adiciona a nova.                            */
/* ------------------------------------------------------------------ */
const UNIQUE_DEFINITION_TYPES = ["raca", "heranca", "vocacao", "carreira"];
const UNIQUE_DEFINITION_LABELS = { raca: "raça", heranca: "herança", vocacao: "vocação", carreira: "carreira" };

Hooks.on("preCreateItem", function (item, data, options, userId) {
  const parent = item.parent; // o Actor, se embutido
  if (!parent || parent.documentName !== "Actor") return;

  // Carreira só pode ser adicionada a um personagem de nível 6.
  if (item.type === "carreira" && parent.type === "personagem") {
    const level = Number(parent.system?.details?.level) || 1;
    if (level < 6) {
      ui.notifications?.warn(`Carreira só pode ser adicionada a personagens de nível 6 (${parent.name} está no nível ${level}).`);
      return false; // impede a criação
    }
  }

  if (!UNIQUE_DEFINITION_TYPES.includes(item.type)) return;
  // Se esta criação já foi autorizada pelo diálogo de substituição, deixa passar.
  if (options.ligeiaConfirmedReplace) return;

  const existing = parent.items.filter((i) => i.type === item.type);
  if (!existing.length) return; // não há conflito, criação normal

  // Já existe uma do mesmo tipo: CANCELA esta criação e abre o diálogo.
  // (preCreateItem é síncrono, então tratamos a confirmação fora dele.)
  const label = UNIQUE_DEFINITION_LABELS[item.type] || item.type;
  promptReplaceUniqueDefinition(parent, item, data, existing, label);
  return false; // impede a criação automática
});

/**
 * Abre uma caixa Sim/Não perguntando se o usuário quer substituir a
 * definição única atual (raça/herança/vocação/carreira). Se sim, remove a
 * antiga e cria a nova; se não, não faz nada.
 */
async function promptReplaceUniqueDefinition(actor, item, data, existing, label) {
  const currentName = existing[0]?.name || `(${label} atual)`;
  const newName = item.name || data?.name || `nova ${label}`;
  const DialogV2 = foundry.applications?.api?.DialogV2;

  let confirmed = false;
  try {
    if (DialogV2?.confirm) {
      confirmed = await DialogV2.confirm({
        window: { title: `Substituir ${label}?` },
        content: `<p>${actor.name} já tem a ${label} <strong>${currentName}</strong>.</p>
                  <p>Deseja substituí-la por <strong>${newName}</strong>?</p>`,
        yes: { label: "Sim, substituir" },
        no: { label: "Não, manter atual" },
        modal: true,
      });
    } else {
      // Fallback para o Dialog clássico.
      confirmed = await Dialog.confirm({
        title: `Substituir ${label}?`,
        content: `<p>${actor.name} já tem a ${label} <strong>${currentName}</strong>.</p>
                  <p>Deseja substituí-la por <strong>${newName}</strong>?</p>`,
      });
    }
  } catch (e) {
    confirmed = false; // se o diálogo for fechado/cancelado, não substitui
  }

  if (!confirmed) {
    ui.notifications?.info(`${label.charAt(0).toUpperCase() + label.slice(1)} mantida: ${currentName}.`);
    return;
  }

  // Remove a(s) antiga(s) e cria a nova (autorizando a criação no hook).
  const ids = existing.map((i) => i.id).filter((id) => actor.items.has(id));
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  const createData = foundry.utils.deepClone(data);
  await actor.createEmbeddedDocuments("Item", [createData], { ligeiaConfirmedReplace: true });
  ui.notifications?.info(`${label.charAt(0).toUpperCase() + label.slice(1)} substituída por ${newName}.`);
}

/* ------------------------------------------------------------------ */
/*  Preload de templates parciais                                      */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Sobrevida ao ativar (efeitos "tempHp")                             */
/*  Quando um item ativável é LIGADO, os efeitos "tempHp" válidos       */
/*  (habilitados e dentro do nível B/A/E) concedem sobrevida ao dono.   */
/*  Regra: sobrevida não acumula — fica o maior valor.                  */
/* ------------------------------------------------------------------ */
Hooks.on("preUpdateItem", function (item, changes, options) {
  const will = foundry.utils.getProperty(changes, "system.active");
  if (will === true && item.system?.active === false) options.ligeiaJustActivated = true;
});

Hooks.on("updateItem", async function (item, changes, options, userId) {
  if (!options.ligeiaJustActivated) return;
  if (game.user.id !== userId) return; // só quem fez a mudança aplica
  const actor = item.parent;
  if (actor?.documentName !== "Actor") return;

  let total = 0;
  for (const e of activeEffectsOf(item)) {
    if (e.type === "tempHp") total += Number(e.value) || 0;
  }
  if (total <= 0) return;

  const res = await applyTempHpToActor(actor, total, { stack: false });
  if (!res.applied) return;
  const keptNote = res.kept ? ' <span class="lig-cond-note">(manteve a atual, maior)</span>' : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="ligeia-roll-flavor"><strong>${item.name}</strong> ativada — <span class="lig-atk-heal">Sobrevida: <strong>${total}</strong></span><div class="lig-heal-applied">Sobrevida atual: ${res.newTemp}${keptNote}</div></div>`,
  });
});

Hooks.once("setup", async function () {
  const partials = [
    "systems/ligeia-rpg/templates/item/partials/header.hbs",
    "systems/ligeia-rpg/templates/item/partials/mode.hbs",
    "systems/ligeia-rpg/templates/item/partials/effects.hbs",
    "systems/ligeia-rpg/templates/item/partials/costs.hbs",
    "systems/ligeia-rpg/templates/item/partials/action.hbs",
    "systems/ligeia-rpg/templates/actor/partials/item-effects-inline.hbs",
    "systems/ligeia-rpg/templates/actor/partials/item-actions.hbs",
  ];
  // V13 expõe loadTemplates em foundry.applications.handlebars
  const loader =
    foundry.applications?.handlebars?.loadTemplates ||
    globalThis.loadTemplates;
  if (loader) await loader(partials);
});
