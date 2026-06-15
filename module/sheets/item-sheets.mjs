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
        // Coleta as condições (checkboxes) por índice de ação a partir do form.
        for (let i = 0; i < arr.length; i++) {
          const boxes = form.querySelectorAll(`input[name="system.actions.${i}.appliesConditions"]`);
          if (boxes && boxes.length) {
            arr[i].appliesConditions = Array.from(boxes).filter((b) => b.checked).map((b) => b.value);
          } else {
            arr[i].appliesConditions = arr[i].appliesConditions || [];
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
    context.damageTypes = CONFIG.LIGEIA?.damageTypes || {};
    // Tipos de dano + opção "qualquer" para o seletor de RD nos efeitos
    context.damageTypesWithAny = { "": "Qualquer", ...(CONFIG.LIGEIA?.damageTypes || {}) };

    // Condições do livro, marcando as que este item já aplica ao alvo.
    const applied = item.system?.appliesConditions || [];
    context.conditionChoices = Object.entries(CONFIG.LIGEIA?.conditions || {}).map(
      ([id, def]) => ({ id, label: def.label, checked: applied.includes(id) }),
    );

    // Ações do item (lista). Cada ação recebe as opções de selects e a lista
    // de condições marcada conforme o que ela aplica, para o editor.
    const condDefs = CONFIG.LIGEIA?.conditions || {};
    context.actions = (item.system?.actions || []).map((a) => ({
      ...a,
      conditionChoices: Object.entries(condDefs).map(([id, def]) => ({
        id, label: def.label, checked: (a.appliesConditions || []).includes(id),
      })),
    }));

    // ----- Opções de ALVO por tipo de efeito -----
    // dice / bonus → rolagens (atributos, ataque, defesa, iniciativa,
    //   conjuração e "todas")
    // stat → valores derivados que recebem +N
    // set → valores que podem ser FIXADOS (atributos + secundários)
    // damage / rd / info → não usam alvo (mostram "—")
    const TARGETS = {
      roll: {
        all: "Todas as rolagens",
        forca: "Força",
        agilidade: "Agilidade",
        vigor: "Vigor",
        mente: "Mente",
        percepcao: "Percepção",
        conjuracao: "Conjuração",
        esquiva: "Esquiva",
        bloqueio: "Bloqueio",
        iniciativa: "Iniciativa",
        attack: "Ataque (qualquer)",
        defense: "Defesa (qualquer)",
      },
      stat: {
        hp: "PV máximo",
        mp: "PM máximo",
        heroic: "Pontos Heroicos máx.",
        deslocamento: "Deslocamento",
      },
      set: {
        forca: "Força",
        agilidade: "Agilidade",
        vigor: "Vigor",
        mente: "Mente",
        percepcao: "Percepção",
        bloqueio: "Bloqueio",
        esquiva: "Esquiva",
        conjuracao: "Conjuração",
        iniciativa: "Iniciativa",
        deslocamento: "Deslocamento",
        percepcao_passiva: "Percepção Passiva",
      },
      none: { all: "—" },
    };
    context.targetOptions = TARGETS;

    // Mapa: tipo de efeito → qual conjunto de alvos usar
    const typeToTargetSet = {
      dice: "roll",
      bonus: "roll",
      stat: "stat",
      set: "set",
      damage: "none",
      rd: "none",
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
      targetMode: "target", includeSelf: false, defenseAttr: "esquiva", defenseAttr2: "",
      damage: "", damageType: "", damageResource: "hp", scalingDamage: false,
      appliesConditions: [], range: 0, area: 0, costMp: 0, costHp: 0, costHeroic: 0,
    });
  }
  static async _onRemoveAction(event, target) {
    await this._removeFromArray("system.actions", Number(target.dataset.index));
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
