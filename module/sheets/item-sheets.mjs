/**
 * Folhas de Item do Ligeia — Foundry V13 (ApplicationV2).
 *
 * Uma classe base genérica + uma PARTS/template por tipo de item.
 */
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/* ================================================================== */
/*  Base                                                              */
/* ================================================================== */
class LigeiaItemSheetBase extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ligeia", "sheet", "item"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    // Permite soltar Macros (e outros) sobre o editor de ações.
    dragDrop: [{ dragSelector: null, dropSelector: null }],
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addEffect: LigeiaItemSheetBase._onAddEffect,
      removeEffect: LigeiaItemSheetBase._onRemoveEffect,
      addCost: LigeiaItemSheetBase._onAddCost,
      removeCost: LigeiaItemSheetBase._onRemoveCost,
      addMeta: LigeiaItemSheetBase._onAddMeta,
      removeMeta: LigeiaItemSheetBase._onRemoveMeta,
      addListItem: LigeiaItemSheetBase._onAddListItem,
      removeListItem: LigeiaItemSheetBase._onRemoveListItem,
      removeTrait: LigeiaItemSheetBase._onRemoveTrait,
      addAction: LigeiaItemSheetBase._onAddAction,
      removeAction: LigeiaItemSheetBase._onRemoveAction,
      addAppliesEffect: LigeiaItemSheetBase._onAddAppliesEffect,
      removeAppliesEffect: LigeiaItemSheetBase._onRemoveAppliesEffect,
      removeMacro: LigeiaItemSheetBase._onRemoveMacro,
      toggleMacro: LigeiaItemSheetBase._onToggleMacro,
      openMacro: LigeiaItemSheetBase._onOpenMacro,
      captureAA: LigeiaItemSheetBase._onCaptureAA,
      clearAA: LigeiaItemSheetBase._onClearAA,
      toggleAA: LigeiaItemSheetBase._onToggleAA,
    },
  };

  /**
   * Protege os campos de array (effects, costs, metamagics, skillList) de
   * serem apagados quando o formulário é submetido sem inputs deles.
   *
   * As alterações nesses arrays acontecem SOMENTE pelos botões de
   * adicionar/remover (que chamam document.update diretamente). Aqui
   * garantimos que um submit normal do formulário (ex.: editar o nome)
   * não sobrescreva esses arrays com vazio.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    let submitData;
    try {
      submitData = super._prepareSubmitData(event, form, formData, updateData);
    } catch (e) {
      submitData = foundry.utils.expandObject(formData?.object ?? {});
    }
    if (!submitData || typeof submitData !== "object") {
      submitData = foundry.utils.expandObject(formData?.object ?? {});
    }
    const sys = submitData.system;
    if (sys && typeof sys === "object") {
      // Durante uma adição/remoção programática (_appendToArray/_removeFromArray),
      // NÃO reconstrói os arrays a partir do form: o update já traz o array
      // correto e o form ainda reflete o estado antigo. Reconstruir aqui
      // sobrescreveria a operação (causava o bug de "não cria ação ao reabrir").
      if (this.#arrayOpInProgress) {
        for (const key of ["actions", "effects", "costs", "metamagics", "skillList", "grantedTraits"]) {
          delete sys[key];
        }
        return submitData;
      }

      // ----- Reconstrói o array system.actions a partir do form -----
      // Descobre quantas ações existem contando os campos .label.
      const actionLabels = form?.querySelectorAll?.('[name^="system.actions."][name$=".label"]');
      if (actionLabels && actionLabels.length) {
        // Converte o objeto indexado (expandObject) em array ordenado.
        let arr = [];
        if (sys.actions && !Array.isArray(sys.actions) && typeof sys.actions === "object") {
          arr = Object.keys(sys.actions)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => sys.actions[k]);
        } else if (Array.isArray(sys.actions)) {
          arr = sys.actions;
        }
        // Remove buracos ANTES de mexer (evita arr[i] undefined).
        arr = arr.filter((v) => v !== undefined && v !== null);
        // Campos que NÃO têm input no form (a macro é vinculada por
        // drag&drop e gerida pelos botões). Preserva-os a partir do
        // documento atual para não serem zerados num submit normal.
        const current = this.document.system.actions || [];
        for (let i = 0; i < arr.length; i++) {
          const cur = current[i] || {};
          if (arr[i].macroUuid === undefined) arr[i].macroUuid = cur.macroUuid || "";
          if (arr[i].macroName === undefined) arr[i].macroName = cur.macroName || "";
          if (arr[i].macroEnabled === undefined) arr[i].macroEnabled = cur.macroEnabled ?? true;
          // Animação por ação (sem input no form): preserva do documento.
          if (arr[i].aaConfig === undefined) arr[i].aaConfig = cur.aaConfig ?? null;
          if (arr[i].aaName === undefined) arr[i].aaName = cur.aaName || "";
          if (arr[i].aaEnabled === undefined) arr[i].aaEnabled = cur.aaEnabled ?? true;
          // Cada ação pode ter appliesEffects como objeto indexado {0:{...}}
          // vindo do form → converte para array.
          const fx = arr[i].appliesEffects;
          if (fx && !Array.isArray(fx) && typeof fx === "object") {
            arr[i].appliesEffects = Object.keys(fx)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => fx[k]);
          }
        }
        sys.actions = arr;
      } else {
        // Form sem nenhum campo de ação → preserva o documento.
        delete sys.actions;
      }

      for (const key of ["effects", "costs", "metamagics", "skillList"]) {
        // Conta quantos índices existem no form para esta chave.
        const inputs = form?.querySelectorAll?.(`[name^="system.${key}."]`) || [];
        if (inputs.length === 0) {
          // O form não tem nenhum input deste array → preserva o que já
          // está no documento (não sobrescreve com vazio).
          delete sys[key];
        } else {
          // Reconstrói o array a partir do objeto indexado do form.
          if (sys[key] && !Array.isArray(sys[key]) && typeof sys[key] === "object") {
            sys[key] = Object.keys(sys[key])
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => sys[key][k]);
          }
          // Se virou array, garante que não há buracos (índices faltando).
          if (Array.isArray(sys[key])) {
            sys[key] = sys[key].filter((v) => v !== undefined && v !== null);
          }
        }
      }
    }
    return submitData;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    context.item = item;
    context.system = item.system;
    context.editable = this.isEditable;
    context.isGM = game.user.isGM;

    // Expõe os arrays no NÍVEL RAIZ do contexto, pois os partials
    // (effects.hbs, costs.hbs, etc.) usam {{#each effects}} / {{#each costs}}
    // herdando o contexto do pai. Sem isto, iteram sobre undefined.
    context.effects = item.system.effects || [];
    context.costs = item.system.costs || [];
    context.metamagics = item.system.metamagics || [];
    context.skillList = item.system.skillList || [];
    context.mode = item.system.mode;
    context.active = item.system.active;

    // Opções para selects
    context.attrChoices = {
      forca: "Força",
      agilidade: "Agilidade",
      vigor: "Vigor",
      mente: "Mente",
      percepcao: "Percepção",
    };
    context.effectTypes = {
      dice: "+Dados de Melhoria",
      bonus: "+Bônus em Rolagem",
      stat: "Modificar Valor",
      set: "Definir Valor",
      damage: "Bônus de Dano",
      rd: "Redução de Dano",
      reroll1: "Rerrolar dados que caem 1",
      reroll6: "Rerrolar dados que caem 6",
      crit: "Crítico aprimorado",
      fumble: "Falha crítica piorada",
      info: "Condição / Texto",
    };
    context.costResources = {
      mp: "Mana (PM)",
      hp: "Vida (PV)",
      hpTemp: "Vida temporária",
      heroic: "Ponto Heroico",
    };
    context.arcaneWords = (CONFIG.LIGEIA?.arcaneWords || []).reduce((acc, w) => {
      acc[w] = w.charAt(0).toUpperCase() + w.slice(1);
      return acc;
    }, {});

    // Opções para o bloco de AÇÃO (ataque/defesa/dano)
    context.attackAttrs = CONFIG.LIGEIA?.attackAttrs || {};
    context.defenseAttrs = CONFIG.LIGEIA?.defenseAttrs || {};
    // Atributos do alvo que podem ser somados à dificuldade fixa. Inclui
    // "nenhum" + primários + especiais (conjuração, iniciativa, esquiva,
    // bloqueio). "iniciativa" não está em attackAttrs, então é incluída aqui.
    context.difficultyAttrChoices = {
      nenhum: "Nenhum",
      forca: "Força",
      agilidade: "Agilidade",
      vigor: "Vigor",
      mente: "Mente",
      percepcao: "Percepção",
      conjuracao: "Conjuração",
      iniciativa: "Iniciativa",
      esquiva: "Esquiva",
      bloqueio: "Bloqueio",
    };
    context.damageTypes = CONFIG.LIGEIA?.damageTypes || {};
    // Tipos de dano + opção "qualquer" para o seletor de RD nos efeitos
    context.damageTypesWithAny = { "": "Qualquer", ...(CONFIG.LIGEIA?.damageTypes || {}) };

    // ----- Opções de ALVO por tipo de efeito -----
    const TARGETS = {
      roll: {
        all: "Todas as rolagens",
        forca: "Força", agilidade: "Agilidade", vigor: "Vigor", mente: "Mente",
        percepcao: "Percepção", conjuracao: "Conjuração",
        esquiva: "Esquiva", bloqueio: "Bloqueio", iniciativa: "Iniciativa",
        attack: "Ataque (qualquer)", defense: "Defesa (qualquer)",
      },
      stat: {
        hp: "PV máximo", mp: "PM máximo", heroic: "Pontos Heroicos máx.", deslocamento: "Deslocamento",
      },
      set: {
        forca: "Força", agilidade: "Agilidade", vigor: "Vigor", mente: "Mente", percepcao: "Percepção",
        bloqueio: "Bloqueio", esquiva: "Esquiva", conjuracao: "Conjuração", iniciativa: "Iniciativa",
        deslocamento: "Deslocamento", percepcao_passiva: "Percepção Passiva",
      },
      none: { all: "—" },
    };
    context.targetOptions = TARGETS;

    // Condições e suas escolhas (id → label)
    const condDefs = CONFIG.LIGEIA?.conditions || {};
    const condChoices = Object.fromEntries(Object.entries(condDefs).map(([id, d]) => [id, d.label]));
    const dmgChoices = { all: "Qualquer", ...(CONFIG.LIGEIA?.damageTypes || {}) };
    // Alvos por tipo de efeito (para o select contextual de appliesEffects)
    const targetsForType = (type) => {
      switch (type) {
        case "bonus":
        case "dice":
        case "reroll1":
        case "reroll6":
        case "crit":
        case "fumble": return TARGETS.roll;
        case "stat": return TARGETS.stat;
        case "set": return TARGETS.set;
        case "damage":
        case "rd": return dmgChoices;
        case "condition": return condChoices;
        default: return TARGETS.roll;
      }
    };

    // Ações do item (lista). Cada efeito aplicado recebe targetChoices conforme seu tipo.
    const aaActive = !!game.modules.get("autoanimations")?.active;
    context.aaActive = aaActive;
    context.actions = (item.system?.actions || []).map((a) => ({
      ...a,
      // Tem animação própria capturada? (config não-vazia)
      hasAnim: !!(a.aaConfig && typeof a.aaConfig === "object" && Object.keys(a.aaConfig).length > 0),
      appliesEffects: (a.appliesEffects || []).map((fx) => ({
        ...fx,
        targetChoices: targetsForType(fx.fxType),
      })),
    }));


    // Mapa: tipo de efeito → qual conjunto de alvos usar
    const typeToTargetSet = {
      dice: "roll",
      bonus: "roll",
      stat: "stat",
      set: "set",
      damage: "none",
      rd: "none",
      reroll1: "roll",
      reroll6: "roll",
      crit: "roll",
      fumble: "roll",
      info: "none",
    };

    // Enriquece cada efeito com as opções de alvo apropriadas e uma flag
    // indicando se o alvo é aplicável (para o template mostrar select ou "—").
    context.effects = (item.system.effects || []).map((e) => {
      const setKey = typeToTargetSet[e.type] || "none";
      const choices = TARGETS[setKey];
      // Se o alvo atual não existe no conjunto deste tipo, usa o primeiro
      // válido (evita um select mostrando valor fora das opções).
      let target = e.target;
      if (!Object.prototype.hasOwnProperty.call(choices, target)) {
        target = Object.keys(choices)[0];
      }
      return {
        ...e,
        target,
        targetSet: setKey,
        targetChoices: choices,
        targetApplies: setKey !== "none",
        // damage e rd podem ter tipo de dano associado
        isDamageType: e.type === "damage" || e.type === "rd",
        // reroll1/reroll6 mostram o campo "todos" e o valor é uma contagem
        isReroll: e.type === "reroll1" || e.type === "reroll6",
      };
    });

    return context;
  }

  #savedScroll = 0;
  // Quando true, o próximo _prepareSubmitData NÃO reconstrói os arrays a
  // partir do form (evita corrida que sobrescreve uma adição/remoção
  // programática feita por _appendToArray/_removeFromArray).
  #arrayOpInProgress = false;

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;

    // Os botões de adicionar/remover itens de lista (efeitos, custos, ações,
    // etc.) são tratados pelo dispatcher nativo de `actions` do ApplicationV2
    // (ver DEFAULT_OPTIONS.actions), que é re-vinculado a cada render. Não
    // usamos mais delegação manual aqui — ela ficava órfã após um re-render
    // que troca o elemento raiz, fazendo os botões de Ação pararem de
    // funcionar até um F5.

    // ----- Drag & drop de MACRO sobre as ações -----
    // Liga um DragDrop a cada render (o elemento muda no re-render do
    // submitOnChange). Permite soltar uma macro nas "drop zones" das ações.
    const DragDropCls =
      foundry.applications.ux?.DragDrop?.implementation ||
      foundry.applications.ux?.DragDrop;
    if (DragDropCls) {
      const dd = new DragDropCls({
        dragSelector: null,
        dropSelector: ".lig-macro-drop",
        permissions: { drop: () => this.isEditable },
        callbacks: { drop: this._onDropMacro.bind(this) },
      });
      dd.bind(root);
    }

    // ----- Preservação de scroll -----
    // O elemento que rola é .ligeia-item-body (o .window-content tem
    // overflow:hidden). Fazemos fallback para outros caso mude.
    const scroller =
      root.querySelector(".ligeia-item-body") ||
      root.querySelector(".ligeia-sheet-body") ||
      root.querySelector(".window-content") ||
      root;
    if (this.#savedScroll) {
      const y = this.#savedScroll;
      requestAnimationFrame(() => { scroller.scrollTop = y; });
    }
    if (scroller.dataset.ligScrollBound !== "1") {
      scroller.dataset.ligScrollBound = "1";
      scroller.addEventListener("scroll", () => {
        this.#savedScroll = scroller.scrollTop;
      });
    }
  }

  /**
   * Recebe uma Macro arrastada para a drop zone de uma ação e a vincula.
   * O índice da ação vem do atributo data-action-index do alvo do drop.
   */
  async _onDropMacro(event) {
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (e) {
      return;
    }
    if (data?.type !== "Macro") {
      ui.notifications?.warn("Arraste uma macro para este campo.");
      return;
    }
    // Descobre a ação alvo pelo elemento da drop zone.
    const zone = event.target?.closest?.(".lig-macro-drop");
    const ai = Number(zone?.dataset?.actionIndex);
    if (!Number.isInteger(ai)) return;

    let macro;
    try {
      macro = await Macro.implementation.fromDropData(data);
    } catch (e) {
      macro = null;
    }
    if (!macro) {
      ui.notifications?.warn("Não foi possível ler a macro arrastada.");
      return;
    }

    const actions = foundry.utils.deepClone(this.document.system.actions || []);
    if (!actions[ai]) return;
    actions[ai].macroUuid = macro.uuid;
    actions[ai].macroName = macro.name;
    actions[ai].macroEnabled = true;
    await this._replaceActions(actions);
    ui.notifications?.info(`Macro "${macro.name}" vinculada à ação.`);
  }

  /* ---- helpers para mutar arrays do system ---- */
  async _appendToArray(path, entry) {
    try {
      const sysPath = path.replace(/^system\./, "");
      const current = foundry.utils.getProperty(this.document.system, sysPath);
      const arr = Array.isArray(current) ? foundry.utils.deepClone(current) : [];
      arr.push(entry);
      this.#arrayOpInProgress = true;
      await this.document.update({ [path]: arr });
    } catch (err) {
      console.error(`Ligeia | ERRO ao adicionar em ${path}:`, err);
      ui.notifications?.error(`Ligeia: falha ao adicionar (${path}). Veja o console.`);
    } finally {
      this.#arrayOpInProgress = false;
    }
  }
  async _removeFromArray(path, index) {
    try {
      const sysPath = path.replace(/^system\./, "");
      const current = foundry.utils.getProperty(this.document.system, sysPath);
      const arr = Array.isArray(current) ? foundry.utils.deepClone(current) : [];
      arr.splice(index, 1);
      this.#arrayOpInProgress = true;
      await this.document.update({ [path]: arr });
    } catch (err) {
      console.error(`Ligeia | ERRO ao remover de ${path}:`, err);
      ui.notifications?.error(`Ligeia: falha ao remover (${path}). Veja o console.`);
    } finally {
      this.#arrayOpInProgress = false;
    }
  }

  /* ---- Efeitos ---- */
  static async _onAddEffect() {
    await this._appendToArray("system.effects", {
      type: "bonus", target: "all", value: 1, label: "", enabled: true,
    });
  }
  static async _onRemoveEffect(event, target) {
    await this._removeFromArray("system.effects", Number(target.dataset.index));
  }

  /* ---- Custos ---- */
  static async _onAddCost() {
    await this._appendToArray("system.costs", { resource: "mp", value: 1, label: "" });
  }
  static async _onRemoveCost(event, target) {
    await this._removeFromArray("system.costs", Number(target.dataset.index));
  }

  /* ---- Metamagias (magia) ---- */
  static async _onAddMeta() {
    await this._appendToArray("system.metamagics", { name: "", wordId: "", description: "" });
  }
  static async _onRemoveMeta(event, target) {
    await this._removeFromArray("system.metamagics", Number(target.dataset.index));
  }

  /* ---- Lista de habilidades (definições) ---- */
  static async _onAddListItem() {
    await this._appendToArray("system.skillList", "");
  }
  static async _onRemoveListItem(event, target) {
    await this._removeFromArray("system.skillList", Number(target.dataset.index));
  }

  /* ---- Traços concedidos (definições) ---- */
  static async _onRemoveTrait(event, target) {
    await this._removeFromArray("system.grantedTraits", Number(target.dataset.index));
  }

  /* ---- Ações (habilidade/magia/equipamento/traço) ---- */
  static async _onAddAction() {
    await this._appendToArray("system.actions", {
      label: "Ação", canRoll: true, rollAttr: "forca", rollBonus: 0, rollDice: 0,
      vsDifficulty: false, fixedDifficulty: 8, difficultyAttr: "nenhum",
      targetMode: "target", includeSelf: false, defenseAttr: "esquiva", defenseAttr2: "",
      damage: "", damageType: "", damageResource: "hp", scalingDamage: false,
      appliesEffects: [], range: 0, area: 0, costMp: 0, costHp: 0, costHeroic: 0,
      persistArea: false, persistRounds: 1, persistAffectsSelf: false,
      persistRerollAttack: false, persistTrigger: "both",
    });
  }
  static async _onRemoveAction(event, target) {
    await this._removeFromArray("system.actions", Number(target.dataset.index));
  }

  /** Reescreve o array inteiro de ações (preservando contra a corrida). */
  async _replaceActions(actions) {
    this.#arrayOpInProgress = true;
    try { await this.document.update({ "system.actions": actions }); }
    finally { this.#arrayOpInProgress = false; }
  }

  /* ---- Efeitos aplicados ao alvo (sub-lista de cada ação) ---- */
  static async _onAddAppliesEffect(event, target) {
    const ai = Number(target.dataset.actionIndex);
    const actions = foundry.utils.deepClone(this.document.system.actions || []);
    if (!actions[ai]) return;
    actions[ai].appliesEffects = actions[ai].appliesEffects || [];
    actions[ai].appliesEffects.push({
      label: "Efeito", fxType: "bonus", fxTarget: "all", fxValue: 0, fxAll: false,
      durationMode: "scene", durationRounds: 1,
      resist: false, resistAttr: "vigor", resistVsCast: true, resistDc: 0,
      tickAmount: 0, tickType: "", tickResource: "hp",
    });
    await this._replaceActions(actions);
  }
  static async _onRemoveAppliesEffect(event, target) {
    const ai = Number(target.dataset.actionIndex);
    const fi = Number(target.dataset.index);
    const actions = foundry.utils.deepClone(this.document.system.actions || []);
    if (!actions[ai]?.appliesEffects) return;
    actions[ai].appliesEffects.splice(fi, 1);
    await this._replaceActions(actions);
  }

  /* ---- Macro vinculada à ação ---- */
  static async _onRemoveMacro(event, target) {
    const ai = Number(target.dataset.actionIndex);
    const actions = foundry.utils.deepClone(this.document.system.actions || []);
    if (!actions[ai]) return;
    actions[ai].macroUuid = "";
    actions[ai].macroName = "";
    await this._replaceActions(actions);
  }
  static async _onToggleMacro(event, target) {
    const ai = Number(target.dataset.actionIndex);
    const actions = foundry.utils.deepClone(this.document.system.actions || []);
    if (!actions[ai]) return;
    actions[ai].macroEnabled = !actions[ai].macroEnabled;
    await this._replaceActions(actions);
  }
  static async _onOpenMacro(event, target) {
    const ai = Number(target.dataset.actionIndex);
    const uuid = this.document.system.actions?.[ai]?.macroUuid;
    if (!uuid) return;
    const macro = await fromUuid(uuid);
    if (macro?.sheet) macro.sheet.render(true);
    else ui.notifications?.warn("Macro não encontrada (foi removida?).");
  }

  /* ---- Animação por ação (Automated Animations) ---- */
  // Captura a config de animação ATUAL do item (definida no menu do Automated
  // Animations) e a guarda nesta ação, para ela ter animação própria.
  static async _onCaptureAA(event, target) {
    const ai = Number(target.dataset.actionIndex);
    if (!game.modules.get("autoanimations")?.active) {
      ui.notifications?.warn("O módulo Automated Animations não está ativo.");
      return;
    }
    const cfg = foundry.utils.deepClone(this.document.flags?.autoanimations ?? null);
    const hasCfg = cfg && typeof cfg === "object" && Object.keys(cfg).length > 0;
    if (!hasCfg) {
      ui.notifications?.warn("O item ainda não tem animação configurada no Automated Animations. Configure-a primeiro (no menu do módulo, na ficha do item) e depois capture.");
      return;
    }
    const actions = foundry.utils.deepClone(this.document.system.actions || []);
    if (!actions[ai]) return;
    actions[ai].aaConfig = cfg;
    actions[ai].aaName = this.document.name;
    actions[ai].aaEnabled = true;
    await this._replaceActions(actions);
    ui.notifications?.info("Animação capturada para esta ação.");
  }
  static async _onClearAA(event, target) {
    const ai = Number(target.dataset.actionIndex);
    const actions = foundry.utils.deepClone(this.document.system.actions || []);
    if (!actions[ai]) return;
    actions[ai].aaConfig = null;
    actions[ai].aaName = "";
    await this._replaceActions(actions);
  }
  static async _onToggleAA(event, target) {
    const ai = Number(target.dataset.actionIndex);
    const actions = foundry.utils.deepClone(this.document.system.actions || []);
    if (!actions[ai]) return;
    actions[ai].aaEnabled = !actions[ai].aaEnabled;
    await this._replaceActions(actions);
  }
}

/* ================================================================== */
/*  Habilidade                                                        */
/* ================================================================== */
export class HabilidadeSheet extends LigeiaItemSheetBase {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    LigeiaItemSheetBase.DEFAULT_OPTIONS,
    { classes: ["ligeia", "sheet", "item", "habilidade"] },
    { inplace: false },
  );
  static PARTS = {
    body: { template: "systems/ligeia-rpg/templates/item/habilidade.hbs" },
  };
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.enrichedBasic = await foundry.applications.ux.TextEditor.implementation.enrichHTML(ctx.system.descBasic || "", { secrets: this.document.isOwner });
    ctx.enrichedAdvanced = await foundry.applications.ux.TextEditor.implementation.enrichHTML(ctx.system.descAdvanced || "", { secrets: this.document.isOwner });
    ctx.enrichedSpecial = await foundry.applications.ux.TextEditor.implementation.enrichHTML(ctx.system.descSpecial || "", { secrets: this.document.isOwner });
    // Habilidades têm efeitos vinculados a nível (B/A/E)
    ctx.showEffectLevel = true;
    return ctx;
  }
}

/* ================================================================== */
/*  Magia                                                             */
/* ================================================================== */
export class MagiaSheet extends LigeiaItemSheetBase {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    LigeiaItemSheetBase.DEFAULT_OPTIONS,
    { classes: ["ligeia", "sheet", "item", "magia"] },
    { inplace: false },
  );
  static PARTS = {
    body: { template: "systems/ligeia-rpg/templates/item/magia.hbs" },
  };
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(ctx.system.description || "", { secrets: this.document.isOwner });
    ctx.enrichedPeculiarities = await foundry.applications.ux.TextEditor.implementation.enrichHTML(ctx.system.peculiarities || "", { secrets: this.document.isOwner });
    ctx.tierChoices = { "Menor": "Menor", "Intermediária": "Intermediária", "Maior": "Maior" };
    return ctx;
  }
}

/* ================================================================== */
/*  Equipamento                                                       */
/* ================================================================== */
export class EquipamentoSheet extends LigeiaItemSheetBase {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    LigeiaItemSheetBase.DEFAULT_OPTIONS,
    { classes: ["ligeia", "sheet", "item", "equipamento"] },
    { inplace: false },
  );
  static PARTS = {
    body: { template: "systems/ligeia-rpg/templates/item/equipamento.hbs" },
  };
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(ctx.system.description || "", { secrets: this.document.isOwner });
    return ctx;
  }
}

/* ================================================================== */
/*  Traço                                                             */
/* ================================================================== */
export class TracoSheet extends LigeiaItemSheetBase {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    LigeiaItemSheetBase.DEFAULT_OPTIONS,
    { classes: ["ligeia", "sheet", "item", "traco"] },
    { inplace: false },
  );
  static PARTS = {
    body: { template: "systems/ligeia-rpg/templates/item/traco.hbs" },
  };
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(ctx.system.description || "", { secrets: this.document.isOwner });
    ctx.sourceChoices = { race: "Racial", heritage: "Herança", background: "Antecedente", other: "Outro" };
    return ctx;
  }
}

/* ================================================================== */
/*  Definições (raça, herança, vocação, organização)                   */
/* ================================================================== */
export class DefinicaoSheet extends LigeiaItemSheetBase {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    LigeiaItemSheetBase.DEFAULT_OPTIONS,
    {
      classes: ["ligeia", "sheet", "item", "definicao"],
      // Permite soltar Itens (habilidades) na ficha da definição.
      dragDrop: [{ dragSelector: null, dropSelector: null }],
    },
    { inplace: false },
  );
  static PARTS = {
    body: { template: "systems/ligeia-rpg/templates/item/definicao.hbs" },
  };
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(ctx.system.description || "", { secrets: this.document.isOwner });
    ctx.itemType = this.document.type; // raca | heranca | vocacao | organizacao
    return ctx;
  }

  /** @override Liga o DragDrop após renderizar (V13 não faz sozinho). */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;
    const DragDropCls =
      foundry.applications.ux?.DragDrop?.implementation ||
      foundry.applications.ux?.DragDrop;
    if (!DragDropCls) return;
    // Religa a cada render (o elemento muda no re-render do submitOnChange).
    const dd = new DragDropCls({
      dragSelector: null,
      dropSelector: null,
      permissions: { drop: () => this.isEditable },
      callbacks: { drop: this._onDropSkill.bind(this) },
    });
    dd.bind(root);
  }

  /**
   * Recebe um item arrastado:
   *  - HABILIDADE → adiciona o NOME à skillList (lista de acesso; casa por
   *    nome no cálculo de XP).
   *  - TRAÇO → adiciona um snapshot a grantedTraits (traços concedidos que
   *    serão criados na ficha do personagem ao inserir esta definição).
   */
  async _onDropSkill(event) {
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (e) {
      return;
    }
    if (data?.type !== "Item") return;

    let dropped;
    try {
      dropped = await Item.implementation.fromDropData(data);
    } catch (e) {
      return;
    }
    if (!dropped) return;

    if (dropped.type === "habilidade") {
      const name = dropped.name;
      const list = foundry.utils.deepClone(this.document.system.skillList || []);
      if (list.some((n) => String(n).trim().toLowerCase() === name.trim().toLowerCase())) {
        ui.notifications?.info(`"${name}" já está na lista de habilidades.`);
        return;
      }
      list.push(name);
      await this.document.update({ "system.skillList": list });
      ui.notifications?.info(`Habilidade "${name}" adicionada à lista.`);
      return;
    }

    if (dropped.type === "traco") {
      const granted = foundry.utils.deepClone(this.document.system.grantedTraits || []);
      if (granted.some((t) => t.name.trim().toLowerCase() === dropped.name.trim().toLowerCase())) {
        ui.notifications?.info(`Traço "${dropped.name}" já está nesta definição.`);
        return;
      }
      granted.push({
        name: dropped.name,
        img: dropped.img || "icons/svg/aura.svg",
        system: foundry.utils.deepClone(dropped.system?.toObject?.() ?? dropped.system ?? {}),
        sourceUuid: dropped.uuid || "",
      });
      await this.document.update({ "system.grantedTraits": granted });
      ui.notifications?.info(`Traço "${dropped.name}" será concedido por esta definição.`);
      return;
    }

    ui.notifications?.warn("Arraste uma Habilidade ou um Traço.");
  }
}
