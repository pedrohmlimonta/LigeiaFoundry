/**
 * Ficha de Personagem do Ligeia — Foundry V13 (ApplicationV2).
 */
import { rollLigeia, postRollToChat, rollItemAction, resolveAttr, rerollFor, critFor, spendItemCosts, applyDamageToActor, applyHealingToActor } from "../helpers/dice.mjs";
import { rollSingleEndEffect } from "../helpers/turn-effects.mjs";
import { promptRollConfig, shouldPromptRoll, currentTargetActors } from "../apps/roll-dialog.mjs";
import { placeTemplateForAction } from "../helpers/template.mjs";
import { computeXpSpent, computeXpGained } from "../helpers/xp.mjs";
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
      addAppliedEffect: LigeiaCharacterSheet.#onAddAppliedEffect,
      removeAppliedEffect: LigeiaCharacterSheet.#onRemoveAppliedEffect,
      toggleAppliedEffect: LigeiaCharacterSheet.#onToggleAppliedEffect,
      tickAppliedEffect: LigeiaCharacterSheet.#onTickAppliedEffect,
      rollEndEffect: LigeiaCharacterSheet.#onRollEndEffect,
      itemRoll: LigeiaCharacterSheet.#onItemRoll,
      editImage: LigeiaCharacterSheet.#onEditImage,
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

  // Evita corrida: durante add/remove programático de appliedEffects, não
  // reconstrói o array a partir do form.
  #fxOpInProgress = false;

  /**
   * Reconstrói system.appliedEffects (array) a partir do form e protege-o
   * contra ser apagado quando uma operação programática está em curso.
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
      if (this.#fxOpInProgress) {
        delete sys.appliedEffects;
        return submitData;
      }
      const hasFx = form?.querySelector?.('[name^="system.appliedEffects."]');
      if (hasFx) {
        if (sys.appliedEffects && !Array.isArray(sys.appliedEffects) && typeof sys.appliedEffects === "object") {
          sys.appliedEffects = Object.keys(sys.appliedEffects)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => sys.appliedEffects[k]);
        }
        if (Array.isArray(sys.appliedEffects)) {
          sys.appliedEffects = sys.appliedEffects.filter((v) => v !== undefined && v !== null);
          for (const ae of sys.appliedEffects) {
            if (ae && ae.effects && !Array.isArray(ae.effects) && typeof ae.effects === "object") {
              ae.effects = Object.keys(ae.effects).sort((a, b) => Number(a) - Number(b)).map((k) => ae.effects[k]);
            }
          }
        }
      } else {
        delete sys.appliedEffects;
      }
    }
    return submitData;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const sys = actor.system;

    context.actor = actor;
    context.system = sys;
    context.isGM = game.user.isGM;
    context.editable = this.isEditable;
    // NPCs usam exatamente a mesma ficha, mas sem NADA de XP.
    context.isNpc = actor.type === "npc";
    // Carreira: personagens só no nível 6; NPCs não têm a restrição.
    context.canAddCareer = context.isNpc || (Number(sys.details?.level) || 1) >= 6;

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
      complicacao: [],
      magia: [],
      equipamento: [],
      traco: [],
      raca: [],
      heranca: [],
      vocacao: [],
      organizacao: [],
      carreira: [],
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

    // Efeitos aplicados na ficha (buffs/debuffs), enriquecidos para exibição.
    // Cada efeito recebe os alvos contextuais (como nos efeitos de habilidade).
    const fxTypeLabels = {
      dice: "Dados", bonus: "Bônus", stat: "Modificar", set: "Definir",
      damage: "Dano", rd: "Red. Dano", reroll1: "Rerrola 1", reroll6: "Rerrola 6",
      crit: "Crít. apr.", fumble: "Falha pior.", info: "Info",
    };
    const rollTargets = {
      all: "Todas as rolagens",
      forca: "Força", agilidade: "Agilidade", vigor: "Vigor", mente: "Mente",
      percepcao: "Percepção", conjuracao: "Conjuração",
      esquiva: "Esquiva", bloqueio: "Bloqueio", iniciativa: "Iniciativa",
      attack: "Ataque (qualquer)", defense: "Defesa (qualquer)",
    };
    const statTargets = { hp: "PV máximo", mp: "PM máximo", heroic: "Pontos Heroicos máx.", deslocamento: "Deslocamento" };
    const setTargets = {
      forca: "Força", agilidade: "Agilidade", vigor: "Vigor", mente: "Mente", percepcao: "Percepção",
      bloqueio: "Bloqueio", esquiva: "Esquiva", conjuracao: "Conjuração", iniciativa: "Iniciativa", deslocamento: "Deslocamento",
    };
    const dmgTargets = { all: "Qualquer", ...(CONFIG.LIGEIA?.damageTypes || {}) };
    const targetsFor = (type) => {
      switch (type) {
        case "bonus": case "dice": case "reroll1": case "reroll6": case "crit": case "fumble": return rollTargets;
        case "stat": return statTargets;
        case "set": return setTargets;
        case "damage": case "rd": return dmgTargets;
        default: return rollTargets;
      }
    };
    context.appliedEffects = (sys.appliedEffects || []).map((ae, idx) => {
      const e0 = (ae.effects && ae.effects[0]) || {};
      const type0 = e0.type || "bonus";
      return {
        ...ae,
        index: idx,
        fx0: e0,
        fx0Type: type0,
        fx0TargetChoices: targetsFor(type0),
        fx0IsReroll: type0 === "reroll1" || type0 === "reroll6",
        fx0NoValue: false,
        summary: [
          (ae.effects || [])
            .map((e) => {
              const sign = (Number(e.value) || 0) >= 0 ? "+" : "";
              const kind = e.type === "dice" ? "D" : "";
              if (e.type === "reroll1") return `Rerrola 1 (${e.rerollAll ? "todos" : e.value})`;
              if (e.type === "reroll6") return `Rerrola 6 (${e.rerollAll ? "todos" : e.value})`;
              if (e.type === "crit") return `Crítico ≥${12 - (Number(e.value) || 0)}`;
              if (e.type === "fumble") return `Falha ≤${2 + (Number(e.value) || 0)}`;
              if (e.type === "areaFilter") return `Áreas: ${e.target === "allies" ? "só aliados" : "só inimigos"}`;
              return `${fxTypeLabels[e.type] || e.type} ${sign}${e.value}${kind} ${e.target || ""}`.trim();
            })
            .join(", "),
          // Etiquetas extras: barreira (sobrevida vinculada) e regeneração
          (Number(ae.tempHp) || 0) > 0 ? `Barreira ${ae.tempHp}` : "",
          (ae.tickHeal?.amount || 0) > 0
            ? `Regen +${ae.tickHeal.amount} ${({ hp: "PV", mp: "PM", heroic: "PH" })[ae.tickHeal.resource || "hp"]}/rodada`
            : "",
        ].filter(Boolean).join(" · "),
        hasDuration: (ae.duration?.rounds || 0) > 0,
      };
    });

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
      damage: "Dano", rd: "Red. Dano", tempHp: "Sobrevida", areaFilter: "Filtro de área", info: "Condição",
    };
    context.effectTargetLabels = {
      all: "todas", forca: "Força", agilidade: "Agilidade", vigor: "Vigor",
      mente: "Mente", percepcao: "Percepção", attack: "Ataque",
      defense: "Defesa", initiative: "Iniciativa", conjuracao: "Conjuração",
      max_hp: "PV máx", max_mp: "PM máx", max_heroic: "PH máx",
      deslocamento: "Deslocamento", bloqueio: "Bloqueio", esquiva: "Esquiva",
      iniciativa: "Iniciativa", percepcao_passiva: "Perc. Passiva",
      allies: "só aliados", enemies: "só inimigos",
    };

    // ---- Cálculo de XP gasto (com regra de dobro fora da lista) ----
    // IMPORTANTE: calcular também para NPCs — os templates envolvem cada
    // item em {{#with (lookup ...)}} e mapas vazios fariam os itens
    // sumirem da lista. Para NPCs a ficha funciona igual à de player;
    // apenas a UI de XP (painel, campo e etiquetas) fica oculta.
    const xp = computeXpSpent(actor);
    // ---- XP concedido pelas complicações (somado ao disponível) ----
    const gain = computeXpGained(actor);
    context.xpSpent = xp.spent;
    context.xpGained = gain.gained;
    context.xpAvailable = (sys.details.xp || 0) + gain.gained - xp.spent;
    // Mapa id → custo, para anotar cada habilidade no template
    context.skillCosts = {};
    for (const s of xp.perSkill) context.skillCosts[s.id] = s;
    // Mapa id → XP concedido, para anotar cada complicação no template
    context.complicationXp = {};
    for (const c of gain.perComplication) context.complicationXp[c.id] = c;

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
    const defTypes = ["raca", "heranca", "vocacao", "organizacao", "carreira"];
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
  /**
   * Abre o seletor de arquivos para trocar uma imagem do ator. O alvo é
   * indicado por data-target: "img" (retrato da ficha) ou
   * "prototypeToken.texture.src" (imagem padrão do token).
   */
  static async #onEditImage(event, target) {
    const attr = target.dataset.target || "img";
    const current = foundry.utils.getProperty(this.document, attr);
    const defaultArtwork = this.document.constructor.getDefaultArtwork?.(this.document.toObject()) || {};
    const fallback = attr === "img" ? defaultArtwork.img : defaultArtwork.texture?.src;
    const FP = foundry.applications.apps.FilePicker?.implementation || FilePicker;
    const fp = new FP({
      type: "image",
      current: current ?? fallback,
      callback: (path) => this.document.update({ [attr]: path }),
      top: (this.position.top ?? 0) + 40,
      left: (this.position.left ?? 0) + 10,
    });
    return fp.browse();
  }

  static async #onItemRoll(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.document.items.get(id);
    if (!item) return;
    const idx = Number(target.dataset.actionIndex ?? 0);
    const action = (item.system.actions || [])[idx];
    if (!action) return;

    // Para ações de área/aura, posiciona o template visual e obtém os atores
    // dentro dele. Se o jogador cancelar o posicionamento, aborta.
    const { proceed, actors, templateId } = await placeTemplateForAction(this.document, item, action);
    if (!proceed) return;

    const result = await rollItemAction({
      actor: this.document,
      item,
      action,
      overrideTargets: actors, // null em modos sem template (usa targeting normal)
      hidden: this.document.system.rollHidden ?? false,
    });

    // Emanação contínua: congela o total do ataque da CRIAÇÃO na flag do
    // template, para os disparos por turno usarem como CD (sem re-rolar).
    // Só faz sentido quando a ação tem rolagem de ATAQUE real (canRoll); com
    // CD fixa pura a dificuldade já é constante e não precisa congelar.
    if (templateId && action.persistArea && action.canRoll && result?.atkRolled && canvas?.scene) {
      try {
        const tpl = canvas.scene.templates.get(templateId);
        if (tpl) {
          await tpl.setFlag("ligeia-rpg", "emanation.attackTotal", Number(result.atkTotal) || 0);
        }
      } catch (e) {
        console.warn("Ligeia | falha ao congelar ataque da emanação:", e);
      }
    }
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

  /** Adiciona um efeito em branco à ficha (buff/debuff manual). */
  static async #onAddAppliedEffect() {
    const arr = foundry.utils.deepClone(this.document.system.appliedEffects || []);
    arr.push({
      label: "Novo efeito",
      icon: "icons/svg/aura.svg",
      effects: [{ type: "bonus", target: "all", value: 1, label: "", enabled: true }],
      disabled: false,
      duration: { rounds: 0, remaining: 0 },
      endRoll: { enabled: false, attr: "mente", dc: 0 },
      source: "",
    });
    this.#fxOpInProgress = true;
      try { await this.document.update({ "system.appliedEffects": arr }); }
      finally { this.#fxOpInProgress = false; }
  }

  static async #onRemoveAppliedEffect(event, target) {
    const idx = Number(target.dataset.index);
    const arr = foundry.utils.deepClone(this.document.system.appliedEffects || []);
    const removed = arr[idx];
    arr.splice(idx, 1);

    const upd = { "system.appliedEffects": arr };

    // Se o efeito removido aplicava uma condição, só mantém a condição se
    // ainda houver outro efeito ATIVO que a aplique.
    const condId = removed?.conditionId;
    if (condId) {
      const stillActive = arr.some((ae) => ae.conditionId === condId && !ae.disabled);
      if (!stillActive) {
        upd["system.conditions"] = (this.document.system.conditions || []).filter((c) => c !== condId);
      }
    }

    this.#fxOpInProgress = true;
    try { await this.document.update(upd); }
    finally { this.#fxOpInProgress = false; }
  }

  static async #onToggleAppliedEffect(event, target) {
    const idx = Number(target.dataset.index);
    const arr = foundry.utils.deepClone(this.document.system.appliedEffects || []);
    if (!arr[idx]) return;
    arr[idx].disabled = !arr[idx].disabled;

    const upd = { "system.appliedEffects": arr };

    // Sincroniza a condição associada ao efeito (se houver).
    const condId = arr[idx].conditionId;
    if (condId) {
      const conds = new Set(this.document.system.conditions || []);
      // Ainda há ALGUM efeito ATIVO (não desativado) que aplica esta condição?
      const stillActive = arr.some((ae) => ae.conditionId === condId && !ae.disabled);
      if (stillActive) {
        // Ao reativar (ou se outro efeito ainda a mantém): garante a condição.
        conds.add(condId);
      } else {
        // Nenhum efeito ativo mantém a condição → desativa automaticamente.
        conds.delete(condId);
      }
      upd["system.conditions"] = Array.from(conds);
    }

    this.#fxOpInProgress = true;
    try { await this.document.update(upd); }
    finally { this.#fxOpInProgress = false; }
  }

  /** Passa uma rodada: aplica dano contínuo e decrementa a duração. */
  static async #onTickAppliedEffect(event, target) {
    const idx = Number(target.dataset.index);
    const arr = foundry.utils.deepClone(this.document.system.appliedEffects || []);
    const ae = arr[idx];
    if (!ae) return;

    // Dano contínuo por rodada (ex.: Corrosão)
    const tick = ae.tickDamage || {};
    if ((tick.amount || 0) > 0) {
      const applied = await applyDamageToActor(this.document, tick.amount, tick.resource || "hp");
      const resLabel = { hp: "PV", mp: "PM", heroic: "PH" }[tick.resource || "hp"];
      const typeLabel = tick.type ? (CONFIG.LIGEIA?.damageTypes?.[tick.type] || tick.type) : "";
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.document }),
        content: `<div class="ligeia-roll-flavor"><strong>${this.document.name}</strong> — <em>${ae.label}</em>: ${tick.amount} de dano${typeLabel ? " " + typeLabel : ""}${applied.applied ? ` (${resLabel}: ${applied.newValue}/${applied.newMax})` : ""}</div>`,
      });
    }

    // Regeneração por rodada (contraparte do dano contínuo)
    const th = ae.tickHeal || {};
    if ((th.amount || 0) > 0) {
      const healed = await applyHealingToActor(this.document, th.amount, th.resource || "hp");
      const hLabel = { hp: "PV", mp: "PM", heroic: "PH" }[th.resource || "hp"];
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.document }),
        content: `<div class="ligeia-roll-flavor"><strong>${this.document.name}</strong> — <em>${ae.label}</em>: <span class="lig-atk-heal">regenera <strong>${th.amount}</strong> ${hLabel}</span>${healed.applied ? ` (${hLabel}: ${healed.newValue}/${healed.newMax})` : ""}</div>`,
      });
    }

    const rounds = ae.duration?.rounds || 0;
    if (rounds > 0) {
      // Duração contada em rodadas
      ae.duration.remaining = Math.max(0, (ae.duration.remaining ?? rounds) - 1);
      if (ae.duration.remaining <= 0) {
        arr.splice(idx, 1);
        const upd = { "system.appliedEffects": arr };
        if (ae.conditionId) {
          upd["system.conditions"] = (this.document.system.conditions || []).filter((c) => c !== ae.conditionId);
        }
        this.#fxOpInProgress = true;
        try { await this.document.update(upd); }
        finally { this.#fxOpInProgress = false; }
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this.document }),
          content: `<div class="ligeia-roll-flavor"><strong>${this.document.name}</strong>: o efeito <em>${ae.label}</em> terminou.</div>`,
        });
        return;
      }
    }
    // rounds === 0 → dura até o fim da cena (não expira por rodada)
    this.#fxOpInProgress = true;
      try { await this.document.update({ "system.appliedEffects": arr }); }
      finally { this.#fxOpInProgress = false; }
  }

  /** Rola para tentar encerrar um efeito (sucesso ≥ CD remove o efeito). */
  static async #onRollEndEffect(event, target) {
    const idx = Number(target.dataset.index);
    this.#fxOpInProgress = true;
    try {
      await rollSingleEndEffect(this.document, idx);
    } finally {
      this.#fxOpInProgress = false;
    }
  }

  static async #onItemToggle(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.document.items.get(id);
    if (!item) return;
    const turningOn = !item.system.active;
    await item.update({ "system.active": !item.system.active });

    // Ao LIGAR um item ativo com custos, desconta os custos obrigatórios
    // (PV/PM/PH) automaticamente e anuncia no chat.
    if (turningOn && item.system.mode === "active") {
      const { text, insufficient, spent } = await spendItemCosts(this.document, item);
      if (spent && text) {
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this.document }),
          flavor: `<div class="ligeia-roll-flavor"><strong>${item.name}</strong> ativada — custo: ${text}${insufficient ? ' <span class="lig-insufficient">(recurso insuficiente!)</span>' : ""}</div>`,
        });
      }
    }
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
      complicacao: "Nova Complicação",
      magia: "Nova Magia",
      equipamento: "Novo Equipamento",
      traco: "Novo Traço",
      raca: "Nova Raça",
      heranca: "Nova Herança",
      vocacao: "Nova Vocação",
      organizacao: "Nova Organização",
      carreira: "Nova Carreira",
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

    const rm = actor.system?.rollMods || {};
    const rr = rerollFor(actor, key);
    const cr = critFor(actor, key);
    await LigeiaCharacterSheet.#rollWithDialog({
      actor,
      label: labels[key] || key,
      attribute: attr.value,
      improvement: attr.dice + (rm.all?.dice || 0),
      bonus: rm.all?.bonus || 0,
      reroll: rr,
      crit: cr,
    });
  }

  /**
   * Rola um atributo/secundário passando (se configurado) pela caixa de
   * rolagem, que permite ajustar bônus, dados, CD ou a defesa do alvo.
   */
  static async #rollWithDialog({ actor, label, attribute, improvement, bonus, reroll, crit }) {
    let imp = improvement;
    let bns = bonus;
    let baseDice = 2;
    let difficulty = null;
    let defAttr = "";

    if (shouldPromptRoll(actor)) {
      const cfg = await promptRollConfig({ title: `${actor.name} — ${label}`, improvement: imp });
      if (!cfg) return; // cancelado
      imp = cfg.improvement;
      baseDice = cfg.baseDice;
      bns += cfg.bonus;
      difficulty = cfg.difficulty;
      defAttr = cfg.defenseAttr || "";
    }

    // Se um atributo de defesa do alvo foi escolhido, o alvo rola a defesa e
    // o resultado dele vira a dificuldade desta rolagem.
    let defResult = null;
    let defActor = null;
    if (defAttr) {
      defActor = currentTargetActors()[0] || null;
      if (defActor) {
        const d = resolveAttr(defActor, defAttr);
        const drm = defActor.system?.rollMods || {};
        const drr = rerollFor(defActor, defAttr, "defense");
        const dcr = critFor(defActor, defAttr, "defense");
        defResult = await rollLigeia({
          attribute: d.value,
          improvement: d.dice + (drm.all?.dice || 0) + (drm.defense?.dice || 0),
          bonus: (drm.all?.bonus || 0) + (drm.defense?.bonus || 0),
          reroll1: drr.reroll1, reroll6: drr.reroll6,
          critBonus: dcr.critBonus, failBonus: dcr.failBonus,
        });
        difficulty = defResult.total;
      }
    }

    const result = await rollLigeia({
      attribute,
      improvement: imp,
      bonus: bns,
      baseDice,
      difficulty,
      reroll1: reroll.reroll1,
      reroll6: reroll.reroll6,
      critBonus: crit.critBonus,
      failBonus: crit.failBonus,
    });

    const hidden = !!actor.system.rollHidden;
    await postRollToChat({ actor, label, result, hidden });
    if (defResult && defActor) {
      const defLabel = CONFIG.LIGEIA?.defenseAttrs?.[defAttr] || defAttr;
      await postRollToChat({ actor: defActor, label: `Defesa (${defLabel})`, result: defResult, hidden });
    }
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

    // Usa o resolvedor central (já considera dados de efeitos nos secundários)
    const r = resolveAttr(actor, key);
    const rm = actor.system?.rollMods || {};
    const rr = rerollFor(actor, key);
    const cr = critFor(actor, key);
    await LigeiaCharacterSheet.#rollWithDialog({
      actor,
      label: labels[key] || key,
      attribute: r.value,
      improvement: r.dice + (rm.all?.dice || 0),
      bonus: rm.all?.bonus || 0,
      reroll: rr,
      crit: cr,
    });
  }
}
