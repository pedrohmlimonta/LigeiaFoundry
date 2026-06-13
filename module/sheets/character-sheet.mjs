/**
 * Ficha de Personagem do Ligeia — Foundry V13 (ApplicationV2).
 */
import { rollLigeia, postRollToChat, rollItemAction } from "../helpers/dice.mjs";
import { placeTemplateForAction } from "../helpers/template.mjs";
import { computeXpSpent } from "../helpers/xp.mjs";
import { effectIsActive } from "../helpers/effects.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class LigeiaCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["ligeia", "sheet", "actor", "personagem"],
    position: { width: 860, height: 760 },
    window: { resizable: true },
    actions: {
      rollAttribute: LigeiaCharacterSheet.#onRollAttribute,
      rollSecondary: LigeiaCharacterSheet.#onRollSecondary,
      itemEdit: LigeiaCharacterSheet.#onItemEdit,
      itemDelete: LigeiaCharacterSheet.#onItemDelete,
      itemToggle: LigeiaCharacterSheet.#onItemToggle,
      effectToggle: LigeiaCharacterSheet.#onEffectToggle,
      conditionToggle: LigeiaCharacterSheet.#onConditionToggle,
      itemRoll: LigeiaCharacterSheet.#onItemRoll,
      itemCreate: LigeiaCharacterSheet.#onItemCreate,
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    dragDrop: [{ dragSelector: ".lig-item-entry", dropSelector: null }],
  };

  /** @override */
  static PARTS = {
    body: {
      template: "systems/ligeia-rpg/templates/actor/personagem.hbs",
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const sys = actor.system;

    context.actor = actor;
    context.system = sys;
    context.isGM = game.user.isGM;
    context.editable = this.isEditable;

    // Enriquece campos HTML para exibição
    context.enriched = {
      personality: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        sys.details.personality || "",
        { secrets: actor.isOwner },
      ),
      notes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        sys.details.notes || "",
        { secrets: actor.isOwner },
      ),
    };

    // Labels dos atributos
    context.attrLabels = {
      forca: "Força",
      agilidade: "Agilidade",
      vigor: "Vigor",
      mente: "Mente",
      percepcao: "Percepção",
    };

    // Agrupa itens embutidos por tipo
    const groups = {
      habilidade: [],
      magia: [],
      equipamento: [],
      traco: [],
      raca: [],
      heranca: [],
      vocacao: [],
      organizacao: [],
    };
    for (const item of actor.items) {
      if (groups[item.type]) groups[item.type].push(item);
    }
    context.itemGroups = groups;

    // Condições: monta a lista completa (do CONFIG) marcando as ativas no ator.
    const activeConds = sys.conditions || [];
    const condDefs = CONFIG.LIGEIA?.conditions || {};
    context.conditions = Object.entries(condDefs).map(([id, def]) => ({
      id,
      label: def.label,
      icon: def.icon,
      desc: def.desc,
      active: activeConds.includes(id),
    }));
    context.activeConditionCount = activeConds.length;

    // Anota em cada efeito de cada item se ele está ativo agora (considerando
    // modo do item, enabled e — para habilidades — o nível adquirido vs.
    // o nível exigido pelo efeito).
    for (const list of Object.values(groups)) {
      for (const item of list) {
        const effects = item.system?.effects || [];
        item._fxView = effects.map((e) => ({
          ...e,
          _active: effectIsActive(item, e),
        }));
      }
    }

    // Rótulos amigáveis para tipos de efeito e alvos (para exibir na ficha
    // sem precisar abrir a edição do item).
    context.effectTypeLabels = {
      dice: "Dados", bonus: "Bônus", stat: "Modifica", set: "Define",
      damage: "Dano", rd: "Red. Dano", info: "Condição",
    };
    context.effectTargetLabels = {
      all: "todas", forca: "Força", agilidade: "Agilidade", vigor: "Vigor",
      mente: "Mente", percepcao: "Percepção", attack: "Ataque",
      defense: "Defesa", initiative: "Iniciativa", conjuracao: "Conjuração",
      max_hp: "PV máx", max_mp: "PM máx", max_heroic: "PH máx",
      deslocamento: "Deslocamento", bloqueio: "Bloqueio", esquiva: "Esquiva",
      iniciativa: "Iniciativa", percepcao_passiva: "Perc. Passiva",
    };

    // ---- Cálculo de XP gasto (com regra de dobro fora da lista) ----
    const xp = computeXpSpent(actor);
    context.xpSpent = xp.spent;
    context.xpAvailable = (sys.details.xp || 0) - xp.spent;
    // Mapa id → custo, para anotar cada habilidade no template
    context.skillCosts = {};
    for (const s of xp.perSkill) context.skillCosts[s.id] = s;

    return context;
  }

  #savedScroll = 0;

  /** @override Configura drag & drop e restaura scroll após renderizar. */
  _onRender(context, options) {
    super._onRender?.(context, options);

    // Preservação de scroll: registra a posição continuamente e restaura
    // após cada re-render (submitOnChange re-renderiza a ficha inteira).
    // O elemento que rola é .ligeia-sheet-body (.window-content tem
    // overflow:hidden).
    const root = this.element;
    if (root) {
      const scroller =
        root.querySelector(".ligeia-sheet-body") ||
        root.querySelector(".window-content") ||
        root;
      // Restaura a posição salva
      if (this.#savedScroll) {
        const y = this.#savedScroll;
        requestAnimationFrame(() => { scroller.scrollTop = y; });
      }
      // Passa a registrar a posição (uma vez só por elemento)
      if (scroller.dataset.ligScrollBound !== "1") {
        scroller.dataset.ligScrollBound = "1";
        scroller.addEventListener("scroll", () => {
          this.#savedScroll = scroller.scrollTop;
        });
      }
    }
    // Cria o manipulador de DragDrop (V13 não faz isso automaticamente)
    const DragDropCls =
      foundry.applications.ux?.DragDrop?.implementation ||
      foundry.applications.ux?.DragDrop;
    if (!DragDropCls) return;
    const dd = new DragDropCls({
      dragSelector: ".lig-item-entry",
      dropSelector: null,
      permissions: {
        dragstart: () => this.isEditable,
        drop: () => this.isEditable,
      },
      callbacks: {
        dragstart: this._onDragStart.bind(this),
        drop: this._onDrop.bind(this),
      },
    });
    dd.bind(this.element);
  }

  /* ---------------------------------------------------------------- */
  /*  Drag & Drop                                                      */
  /* ---------------------------------------------------------------- */

  /** @override Inicia o drag de um item embutido. */
  _onDragStart(event) {
    const li = event.currentTarget.closest("[data-item-id]");
    if (!li) return super._onDragStart(event);
    const item = this.document.items.get(li.dataset.itemId);
    if (!item) return;
    const dragData = item.toDragData();
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  /** @override Recebe um drop de Item. */
  async _onDrop(event) {
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (e) {
      return super._onDrop?.(event);
    }
    if (data?.type !== "Item") return super._onDrop?.(event);

    const item = await Item.implementation.fromDropData(data);
    if (!item) return;

    // Se já é do próprio ator (reordenar), ignora; senão cria cópia embutida
    if (item.parent === this.document) return;

    const toCreate = [item.toObject()];

    // Se for uma DEFINIÇÃO (raça/herança/vocação/organização) que concede
    // traços, cria também esses traços como itens embutidos.
    const defTypes = ["raca", "heranca", "vocacao", "organizacao"];
    if (defTypes.includes(item.type)) {
      const granted = item.system?.grantedTraits || [];
      for (const t of granted) {
        if (!t?.name) continue;
        // Evita duplicar um traço de mesmo nome já presente no ator.
        const exists = this.document.items.some(
          (i) => i.type === "traco" && i.name.trim().toLowerCase() === t.name.trim().toLowerCase(),
        );
        if (exists) continue;
        toCreate.push({
          name: t.name,
          type: "traco",
          img: t.img || "icons/svg/aura.svg",
          system: foundry.utils.deepClone(t.system || {}),
        });
      }
    }

    await this.document.createEmbeddedDocuments("Item", toCreate);
  }

  /* ---------------------------------------------------------------- */
  /*  Ações de Item                                                    */
  /* ---------------------------------------------------------------- */

  static async #onItemEdit(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.document.items.get(id);
    item?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.document.items.get(id);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remover item" },
      content: `<p>Remover <strong>${item.name}</strong> da ficha?</p>`,
    });
    if (ok) await item.delete();
  }

  /**
   * Executa a ação/rolagem de um item (habilidade, magia, equipamento,
   * traço): rola o atributo de ataque e, se configurado, resolve a defesa
   * do(s) alvo(s) e o dano.
   */
  static async #onItemRoll(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.document.items.get(id);
    if (!item) return;
    const idx = Number(target.dataset.actionIndex ?? 0);
    const action = (item.system.actions || [])[idx];
    if (!action) return;

    // Para ações de área/aura, posiciona o template visual e obtém os atores
    // dentro dele. Se o jogador cancelar o posicionamento, aborta.
    const { proceed, actors } = await placeTemplateForAction(this.document, action);
    if (!proceed) return;

    await rollItemAction({
      actor: this.document,
      item,
      action,
      overrideTargets: actors, // null em modos sem template (usa targeting normal)
      hidden: this.document.system.rollHidden ?? false,
    });
  }

  /** Liga/desliga uma condição na ficha. */
  static async #onConditionToggle(event, target) {
    const id = target.dataset.conditionId;
    if (!id) return;
    const current = this.document.system.conditions || [];
    const has = current.includes(id);
    const next = has ? current.filter((c) => c !== id) : [...current, id];
    await this.document.update({ "system.conditions": next });
  }

  static async #onItemToggle(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.document.items.get(id);
    if (!item) return;
    await item.update({ "system.active": !item.system.active });
  }

  /**
   * Liga/desliga UM efeito específico de um item embutido, direto da ficha
   * do personagem (sem abrir a edição do item).
   */
  static async #onEffectToggle(event, target) {
    const id = target.dataset.itemId;
    const index = Number(target.dataset.effectIndex);
    const item = this.document.items.get(id);
    if (!item || Number.isNaN(index)) return;
    const effects = foundry.utils.deepClone(item.system.effects || []);
    if (!effects[index]) return;
    effects[index].enabled = !effects[index].enabled;
    await item.update({ "system.effects": effects });
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const names = {
      habilidade: "Nova Habilidade",
      magia: "Nova Magia",
      equipamento: "Novo Equipamento",
      traco: "Novo Traço",
      raca: "Nova Raça",
      heranca: "Nova Herança",
      vocacao: "Nova Vocação",
      organizacao: "Nova Organização",
    };
    await this.document.createEmbeddedDocuments("Item", [
      { name: names[type] || "Novo Item", type },
    ]);
  }

  /* ---------------------------------------------------------------- */
  /*  Ações de Rolagem                                                 */
  /* ---------------------------------------------------------------- */

  /** Rola um atributo primário (2d6 + valor + dados de melhoria). */
  static async #onRollAttribute(event, target) {
    const key = target.dataset.attr;
    const actor = this.document;
    const attr = actor.system.attributes[key];
    if (!attr) return;

    const labels = {
      forca: "Força",
      agilidade: "Agilidade",
      vigor: "Vigor",
      mente: "Mente",
      percepcao: "Percepção",
    };

    const result = await rollLigeia({
      attribute: attr.value,
      improvement: attr.dice,
      bonus: 0,
    });

    await postRollToChat({
      actor,
      label: labels[key] || key,
      result,
      hidden: !!actor.system.rollHidden,
    });
  }

  /** Rola um atributo secundário. */
  static async #onRollSecondary(event, target) {
    const key = target.dataset.secondary;
    const actor = this.document;
    const sec = actor.system.secondary;
    if (!sec) return;

    const labels = {
      bloqueio: "Bloqueio",
      esquiva: "Esquiva",
      conjuracao: "Conjuração",
      iniciativa: "Iniciativa",
    };

    // Dados de melhoria: iniciativa tem os seus; os demais herdam do atributo base
    let value = sec[key] || 0;
    let dice = 0;
    if (key === "iniciativa") dice = sec.iniciativaDice || 0;
    else if (key === "bloqueio") dice = actor.system.attributes.forca.dice;
    else if (key === "esquiva") dice = actor.system.attributes.agilidade.dice;
    else if (key === "conjuracao") dice = actor.system.attributes.mente.dice;

    const result = await rollLigeia({
      attribute: value,
      improvement: dice,
      bonus: 0,
    });

    await postRollToChat({
      actor,
      label: labels[key] || key,
      result,
      hidden: !!actor.system.rollHidden,
    });
  }
}
