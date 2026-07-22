/**
 * Ligéia — Ficha Elegante
 * ------------------------------------------------------------------
 * Módulo de APARÊNCIA. Não toca no sistema "ligeia-rpg": apenas registra
 * uma ficha alternativa para o ator do tipo "personagem", herdando TODA a
 * lógica original (rolagens, itens, efeitos, condições, XP, drag&drop e a
 * preservação de scroll). Aqui só trocamos o template do corpo por uma versão
 * em abas, acrescentamos as barras de recurso e um sistema de FAVORITOS.
 *
 * Decisões importantes:
 *  - A navegação por abas é ligada MANUALMENTE em _onRender (delegação no
 *    elemento raiz, com guarda anti-duplicação). NÃO usamos `static TABS` nem
 *    a action "tab": o ApplicationV2 (v13) tem um sistema de abas nativo que
 *    reage a `static TABS`/`data-action="tab"` e interfere no clique.
 *  - Favoritos de ITENS: flag por item (`flags.<módulo>.fav`). Estável, pois
 *    item.id não muda. As AÇÕES do item vêm junto na aba de favoritos.
 *  - Favoritos de EFEITOS aplicados: o sistema guarda esses efeitos num array
 *    sem id estável (e o schema descarta campos extras), então favoritamos por
 *    NOME do efeito numa flag do ATOR. Não altera o sistema.
 */

// Agora parte do SISTEMA: as flags de favoritos usam o escopo do próprio
// sistema ("ligeia-rpg"), que é sempre válido. (Antes era o id do módulo.)
const MODULE_ID = "ligeia-rpg";

import { LigeiaCharacterSheet } from "./character-sheet.mjs";

/** Abas (ordem). Favoritos primeiro. NÃO usar `static TABS` (ver topo). */
const TAB_DEFS = [
  { id: "favoritos", label: "Favoritos", icon: "fa-solid fa-star" },
  { id: "atributos", label: "Atributos", icon: "fa-solid fa-dice-d20" },
  { id: "equipamentos", label: "Equipamentos", icon: "fa-solid fa-toolbox" },
  { id: "habilidades", label: "Habilidades", icon: "fa-solid fa-hand-fist" },
  { id: "complicacoes", label: "Complicações", icon: "fa-solid fa-heart-crack" },
  { id: "magias", label: "Magias", icon: "fa-solid fa-wand-magic-sparkles" },
  { id: "tracos", label: "Traços", icon: "fa-solid fa-fingerprint" },
  { id: "efeitos", label: "Efeitos & Condições", icon: "fa-solid fa-bolt" },
  { id: "notas", label: "Personalidade & Notas", icon: "fa-solid fa-feather" },
];

/** Tipos de item favoritáveis e seus rótulos na aba de favoritos. */
const FAV_KINDS = { habilidade: "Habilidade", complicacao: "Complicação", magia: "Magia", equipamento: "Equipamento", traco: "Traço" };

/** Lê uma flag do módulo de forma segura (funciona fora do Foundry também). */
function getFlag(doc, key) {
  if (doc && typeof doc.getFlag === "function") return doc.getFlag(MODULE_ID, key);
  return doc?.flags?.[MODULE_ID]?.[key];
}

class LigeiaFichaElegante extends LigeiaCharacterSheet {
  /** Aba ativa — persiste na instância para sobreviver aos re-renders. */
  #activeTab = "atributos";
  /**
   * Referência ESTÁVEL do handler de cliques. Guardada uma vez para que o
   * removeEventListener consiga encontrá-la e removê-la, garantindo que nunca
   * exista mais de um listener mesmo re-ligando a cada render.
   */
  #onUiClickBound = this.#onUiClick.bind(this);

  /**
   * Só os DELTAS. NÃO declaramos a action "tab": a navegação é tratada
   * manualmente em _onRender. As actions do sistema (rolagens, itens, efeitos)
   * continuam valendo via a fusão de DEFAULT_OPTIONS da cadeia de herança.
   */
  static DEFAULT_OPTIONS = {
    classes: ["ligeia", "sheet", "actor", "personagem", "ligeia-fe"],
  };

  /** Troca o template do corpo pela versão em abas (mesma part "body"). */
  static PARTS = {
    // scrollable [""] preserva a rolagem do corpo; as listas internas são
    // preservadas pelos hooks herdados de LigeiaCharacterSheet.
    body: { template: `systems/ligeia-rpg/templates/ficha-elegante.hbs`, scrollable: [""] },
  };

  /** @override Acrescenta barras, abas e favoritos ao contexto herdado. */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const sys = actor.system ?? {};

    // ----- Barras de recurso (PV vermelho-sangue, PM azul, PH verde) -----
    const pct = (v, m) => {
      const mm = Number(m) || 0;
      if (mm <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round(((Number(v) || 0) / mm) * 100)));
    };
    const hp = sys.resources?.hp ?? {};
    const mp = sys.resources?.mp ?? {};
    const ph = sys.resources?.heroic ?? {};
    const hpPct = pct(hp.value, hp.max);
    context.bars = {
      hp: { pct: hpPct, tempPct: pct(hp.temp, hp.max), low: hpPct <= 30 },
      mp: { pct: pct(mp.value, mp.max) },
      heroic: { pct: pct(ph.value, ph.max) },
    };

    // ----- Favoritos: ITENS (flag por item) -----
    const g = context.itemGroups ?? {};
    const favItems = [];
    for (const [type, label] of Object.entries(FAV_KINDS)) {
      for (const it of g[type] ?? []) {
        const isFav = !!getFlag(it, "fav");
        it.isFav = isFav; // estado da estrela na aba do tipo
        it.kindLabel = label; // rótulo na aba de favoritos
        if (isFav) favItems.push(it);
      }
    }
    context.favItems = favItems;

    // ----- Favoritos: EFEITOS aplicados (por nome, flag no ator) -----
    const favLabels = new Set(getFlag(actor, "favEffectLabels") || []);
    for (const ae of context.appliedEffects ?? []) ae.isFav = favLabels.has(ae.label);
    context.favEffects = (context.appliedEffects ?? []).filter((ae) => ae.isFav);

    context.favCount = favItems.length + context.favEffects.length;

    // ----- Abas + contadores -----
    const counts = {
      favoritos: context.favCount,
      equipamentos: (g.equipamento ?? []).length,
      habilidades: (g.habilidade ?? []).length,
      complicacoes: (g.complicacao ?? []).length,
      magias: (g.magia ?? []).length,
      tracos: (g.traco ?? []).length,
      efeitos: (context.appliedEffects ?? []).length + (context.activeConditionCount ?? 0),
    };
    context.activeTab = this.#activeTab;
    context.tabs = TAB_DEFS.map((t) => ({ ...t, count: counts[t.id] ?? 0, active: t.id === this.#activeTab }));

    return context;
  }

  /** @override Mantém a lógica do sistema (scroll, drag&drop) e liga a UI. */
  _onRender(context, options) {
    super._onRender(context, options);
    this._applyActiveTab();
    // Re-afirma o listener de cliques a CADA render. Algumas ações (marcar
    // alvo com T, submitOnChange, etc.) disparam um re-render que RECONSTRÓI o
    // elemento raiz; o ApplicationV2 religa as ações dele nesse momento, mas um
    // listener ligado só uma vez ficaria preso no elemento antigo (e as abas
    // parariam de responder até um F5). Religar sempre — com a MESMA referência
    // — garante exatamente um handler ativo no elemento atual, sem empilhar.
    const root = this.element;
    if (root) {
      root.removeEventListener("click", this.#onUiClickBound);
      root.addEventListener("click", this.#onUiClickBound);
    }
  }

  /** Liga as classes .active da aba e do painel correspondentes a #activeTab. */
  _applyActiveTab() {
    const root = this.element;
    if (!root) return;
    for (const b of root.querySelectorAll(".lig-tab")) {
      b.classList.toggle("active", b.dataset.tab === this.#activeTab);
    }
    for (const p of root.querySelectorAll(".lig-tab-panel")) {
      p.classList.toggle("active", p.dataset.tab === this.#activeTab);
    }
  }

  /** Trata cliques de aba e de favoritar (sem mexer nas actions do sistema). */
  #onUiClick(event) {
    const root = this.element;
    if (!root) return;

    // 1) Troca de aba — instantânea, sem re-render.
    const tabBtn = event.target.closest(".lig-tab");
    if (tabBtn && root.contains(tabBtn)) {
      const id = tabBtn.dataset.tab;
      if (id) {
        this.#activeTab = id;
        this._applyActiveTab();
      }
      return;
    }

    // 2) Favoritar/desfavoritar um ITEM (flag no item).
    const favItemBtn = event.target.closest(".lig-fav-btn");
    if (favItemBtn && root.contains(favItemBtn)) {
      event.preventDefault();
      const id = favItemBtn.closest("[data-item-id]")?.dataset.itemId;
      const item = id ? this.document.items.get(id) : null;
      if (item) item.setFlag(MODULE_ID, "fav", !getFlag(item, "fav"));
      return;
    }

    // 3) Favoritar/desfavoritar um EFEITO aplicado (por nome, flag no ator).
    const favFxBtn = event.target.closest(".lig-fav-effect");
    if (favFxBtn && root.contains(favFxBtn)) {
      event.preventDefault();
      const label = favFxBtn.dataset.favEffect ?? "";
      const cur = this.document.getFlag(MODULE_ID, "favEffectLabels") || [];
      const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
      this.document.setFlag(MODULE_ID, "favEffectLabels", next);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Registro da ficha                                                  */
/* ------------------------------------------------------------------ */
Hooks.once("init", () => {
  // Helpers usados pelo template — registrados defensivamente (idempotente).
  if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);
  if (!Handlebars.helpers.lt) Handlebars.registerHelper("lt", (a, b) => a < b);
  if (!Handlebars.helpers.or) Handlebars.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));

  const DSC = foundry.applications.apps.DocumentSheetConfig;
  DSC.registerSheet(Actor, "ligeia-rpg", LigeiaFichaElegante, {
    types: ["personagem", "npc"],
    makeDefault: true,
    label: "Ligéia — Ficha Elegante (abas)",
  });

  console.log(`${MODULE_ID} | Ficha Elegante registrada para 'personagem'.`);
});

/* ------------------------------------------------------------------ */
/*  Pré-carrega os partials do sistema reaproveitados pelo template    */
/* ------------------------------------------------------------------ */
Hooks.once("setup", async () => {
  const loader = foundry.applications?.handlebars?.loadTemplates || globalThis.loadTemplates;
  if (!loader) return;
  await loader([
    "systems/ligeia-rpg/templates/actor/partials/item-actions.hbs",
    "systems/ligeia-rpg/templates/actor/partials/item-effects-inline.hbs",
  ]);
});
