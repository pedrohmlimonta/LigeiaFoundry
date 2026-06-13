/**
 * Ligeia RPG — Sistema para Foundry VTT V13
 * Ponto de entrada (ES module).
 */
import { LigeiaActor } from "./documents/actor.mjs";
import { LigeiaItem } from "./documents/item.mjs";
import { LigeiaCharacterSheet } from "./sheets/character-sheet.mjs";
import {
  HabilidadeSheet,
  MagiaSheet,
  EquipamentoSheet,
  TracoSheet,
  DefinicaoSheet,
} from "./sheets/item-sheets.mjs";
import { PersonagemData, NpcData } from "./data/actor-data.mjs";
import {
  HabilidadeData,
  MagiaData,
  EquipamentoData,
  TracoData,
  RacaData,
  HerancaData,
  VocacaoData,
  OrganizacaoData,
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

  // DataModels — Actors
  CONFIG.Actor.dataModels = {
    personagem: PersonagemData,
    npc: NpcData,
  };

  // DataModels — Items
  CONFIG.Item.dataModels = {
    habilidade: HabilidadeData,
    magia: MagiaData,
    equipamento: EquipamentoData,
    traco: TracoData,
    raca: RacaData,
    heranca: HerancaData,
    vocacao: VocacaoData,
    organizacao: OrganizacaoData,
  };

  // Constantes do sistema (palavras arcanas, custos de XP, etc.)
  CONFIG.LIGEIA = {
    // Custo de XP por nível de habilidade
    skillCost: { B: 20, A: 40, E: 80 },
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
    damageTypes: {
      corte: "Corte",
      perfuracao: "Perfuração",
      concussao: "Concussão",
      fogo: "Fogo",
      gelo: "Gelo",
      eletrico: "Elétrico",
      acido: "Ácido",
      veneno: "Veneno",
      psiquico: "Psíquico",
      sagrado: "Sagrado",
      profano: "Profano",
      puro: "Puro",
    },

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
    },
  };

  // ---- Registro de folhas (sheets) ----
  // Foundry V13: foundry.applications.apps.DocumentSheetConfig
  const DSC = foundry.applications.apps.DocumentSheetConfig;

  DSC.registerSheet(Actor, "ligeia-rpg", LigeiaCharacterSheet, {
    types: ["personagem"],
    makeDefault: true,
    label: "Ligeia — Ficha de Personagem",
  });

  // Folhas de Item
  DSC.registerSheet(Item, "ligeia-rpg", HabilidadeSheet, {
    types: ["habilidade"], makeDefault: true, label: "Ligeia — Habilidade",
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
    types: ["raca", "heranca", "vocacao", "organizacao"],
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
});

/* ------------------------------------------------------------------ */
/*  Preload de templates parciais                                      */
/* ------------------------------------------------------------------ */
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
