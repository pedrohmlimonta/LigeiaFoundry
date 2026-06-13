/**
 * Motor de rolagem do Ligeia.
 *
 * Mecânica (Sessão 2 do livro):
 *  - Rola 2D6 + dados de melhoria extras.
 *  - Apenas os 2 MAIORES dados entram na soma.
 *  - Soma os 2 maiores + atributo + bônus = resultado.
 *  - Sucesso crítico: os 2 dados que entram na soma são ambos "6"
 *    E o resultado iguala/supera a dificuldade (se houver).
 *  - Falha crítica: os 2 dados que entram na soma são ambos "1".
 */

/**
 * Executa uma rolagem do Ligeia e devolve um objeto Roll do Foundry
 * já avaliado, mais metadados de crítico.
 *
 * @param {object} opts
 * @param {number} opts.attribute   valor do atributo
 * @param {number} opts.improvement nº de dados de melhoria extras (além dos 2D)
 * @param {number} opts.bonus       bônus/redutor plano
 * @param {number|null} opts.difficulty dificuldade (ou null)
 * @returns {Promise<{roll: Roll, kept: number[], dropped: number[], total: number,
 *                     isCritSuccess: boolean, isCritFail: boolean,
 *                     outcome: string|null}>}
 */
export async function rollLigeia({
  attribute = 0,
  improvement = 0,
  bonus = 0,
  difficulty = null,
} = {}) {
  const totalDice = 2 + Math.max(0, improvement);
  // keep highest 2 (kh2). Mantém os 2 maiores; descarta o resto.
  const flat = (attribute || 0) + (bonus || 0);
  const formulaParts = [`${totalDice}d6kh2`];
  if (flat !== 0) formulaParts.push(`${flat >= 0 ? "+" : "-"} ${Math.abs(flat)}`);
  const formula = formulaParts.join(" ");

  const roll = new Roll(formula);
  await roll.evaluate();

  // Extrai os dados individuais
  const dieTerm = roll.dice[0];
  const results = dieTerm ? dieTerm.results : [];
  const kept = results.filter((r) => r.active).map((r) => r.result);
  const dropped = results.filter((r) => !r.active).map((r) => r.result);

  // Crítico avaliado nos dados que entram na soma (os 2 maiores)
  const keptSorted = [...kept].sort((a, b) => a - b);
  const isCritSuccessDice =
    kept.length >= 2 && kept.every((v) => v === 6);
  const isCritFail = kept.length >= 2 && kept.every((v) => v === 1);

  const total = roll.total;

  let outcome = null;
  if (difficulty != null) {
    outcome = total >= difficulty ? "success" : "fail";
  }

  // Sucesso crítico só vale se igualar/superar a dificuldade (quando há uma).
  // Sem dificuldade, 6+6 já conta como crítico.
  const isCritSuccess =
    isCritSuccessDice && (difficulty == null || total >= difficulty);

  return {
    roll,
    kept,
    dropped,
    total,
    isCritSuccess,
    isCritFail,
    outcome,
    difficulty,
    flat,
    totalDice,
  };
}

/**
 * Monta o conteúdo HTML da mensagem de chat para uma rolagem.
 */
export function buildRollFlavor({ label, result }) {
  let tag = "";
  if (result.isCritSuccess) {
    tag = `<span class="ligeia-crit success">✦ Sucesso Crítico ✦</span>`;
  } else if (result.isCritFail) {
    tag = `<span class="ligeia-crit fail">✗ Falha Crítica ✗</span>`;
  } else if (result.outcome === "success") {
    tag = `<span class="ligeia-outcome ok">✓ Sucesso (DC ${result.difficulty})</span>`;
  } else if (result.outcome === "fail") {
    tag = `<span class="ligeia-outcome ko">✗ Falha (DC ${result.difficulty})</span>`;
  }
  return `<div class="ligeia-roll-flavor"><strong>${label || "Rolagem"}</strong>${
    tag ? " " + tag : ""
  }</div>`;
}

/**
 * Posta uma rolagem no chat do Foundry.
 *
 * @param {object} opts
 * @param {Actor} opts.actor
 * @param {string} opts.label
 * @param {object} opts.result  retorno de rollLigeia
 * @param {boolean} opts.hidden se true, sussurra só para GMs (blind)
 */
export async function postRollToChat({ actor, label, result, hidden = false }) {
  const flavor = buildRollFlavor({ label, result });
  const speaker = ChatMessage.getSpeaker({ actor });

  const messageData = {
    speaker,
    flavor,
    rolls: [result.roll],
    sound: CONFIG.sounds.dice,
  };

  if (hidden) {
    // Rolagem oculta: visível só para o GM (e o autor vê como blind roll)
    messageData.whisper = ChatMessage.getWhisperRecipients("GM");
    messageData.blind = true;
  }

  return ChatMessage.create(messageData);
}

/* ======================================================================== */
/*  AÇÕES DE ITEM: rolagem de ataque, defesa do alvo e dano com tipo         */
/* ======================================================================== */

/**
 * Resolve {value, dice} de um atributo (primário ou secundário) de um ator.
 * Atributos secundários: bloqueio, esquiva, conjuracao, iniciativa.
 * Atributos primários: forca, agilidade, vigor, mente, percepcao.
 */
export function resolveAttr(actor, key) {
  const sys = actor?.system || {};
  const prim = sys.attributes?.[key];
  if (prim) return { value: prim.value || 0, dice: prim.dice || 0, key };
  const sec = sys.secondary || {};
  if (key in sec) {
    const value = sec[key] || 0;
    // Iniciativa herda dados de melhoria; os demais secundários herdam do
    // atributo-base correspondente.
    const diceMap = {
      bloqueio: sys.attributes?.forca?.dice || 0,
      esquiva: sys.attributes?.agilidade?.dice || 0,
      conjuracao: sys.attributes?.mente?.dice || 0,
      iniciativa: sec.iniciativaDice || 0,
    };
    return { value, dice: diceMap[key] || 0, key };
  }
  return { value: 0, dice: 0, key };
}

/**
 * Soma a Redução de Dano (RD) de um ator para um tipo de dano específico,
 * a partir dos efeitos ativos dos seus itens (type "rd"). Um efeito de RD
 * sem damageType (ou "all") reduz qualquer tipo.
 *
 * Requer importar effectIsActive de effects.mjs no chamador? Não — fazemos
 * aqui uma checagem simples de enabled + modo, espelhando a lógica.
 */
export function damageReductionFor(actor, damageType) {
  let rd = 0;
  for (const item of actor.items) {
    const mode = item.system?.mode;
    const itemOn = mode === "active" ? !!item.system.active : true;
    if (!itemOn) continue;
    for (const e of item.system?.effects || []) {
      if (e.type !== "rd" || e.enabled === false) continue;
      const t = e.damageType || "";
      if (!t || t === "all" || t === damageType) rd += Number(e.value) || 0;
    }
  }
  return rd;
}

/**
 * Aplica dano/drenagem a um recurso de um ator.
 *  - "hp" (Vida): desconta do PV temporário primeiro, depois do PV.
 *  - "mp" (Mana) / "heroic" (Pontos Heroicos): desconta direto do valor.
 *
 * Só altera a ficha se o usuário tiver permissão (OWNER) sobre o alvo.
 *
 * @param {Actor} actor  alvo
 * @param {number} amount  quantidade já calculada
 * @param {string} resource  "hp" | "mp" | "heroic"
 */
export async function applyDamageToActor(actor, amount, resource = "hp") {
  const dmg = Math.max(0, Math.floor(amount));
  const res = actor.system?.resources?.[resource];
  if (!res || dmg <= 0) {
    return { applied: false, dmg, fromTemp: 0, resource };
  }
  if (!actor.isOwner) {
    return { applied: false, dmg, fromTemp: 0, resource, noPermission: true };
  }

  const update = {};
  let fromTemp = 0;
  let rest = dmg;

  // PV temporário só existe para hp
  if (resource === "hp") {
    const temp = res.temp || 0;
    fromTemp = Math.min(temp, dmg);
    rest = dmg - fromTemp;
    update["system.resources.hp.temp"] = temp - fromTemp;
  }

  const newValue = Math.max(0, (res.value || 0) - rest);
  update[`system.resources.${resource}.value`] = newValue;
  await actor.update(update);

  return {
    applied: true,
    dmg,
    fromTemp,
    newValue,
    newMax: res.max,
    resource,
    downed: resource === "hp" && newValue <= 0,
  };
}

/**
 * Adiciona condições (ids) à ficha de um ator, sem duplicar. Só funciona se
 * o usuário tiver permissão sobre o alvo.
 * @returns {string[]} rótulos das condições efetivamente adicionadas
 */
export async function applyConditionsToActor(actor, ids = []) {
  if (!ids.length || !actor?.isOwner) return [];
  const current = actor.system?.conditions || [];
  const toAdd = ids.filter((id) => !current.includes(id));
  if (!toAdd.length) return [];
  await actor.update({ "system.conditions": [...current, ...toAdd] });
  const defs = CONFIG.LIGEIA?.conditions || {};
  return toAdd.map((id) => defs[id]?.label || id);
}

/**
 * Aplica o dano e as condições de uma ação a UM ator-alvo, devolvendo o
 * HTML de detalhamento. Usado tanto para alvos mirados quanto para o próprio
 * personagem (self/area/aura com includeSelf). `acertou` indica se a defesa
 * falhou (ou se não houve defesa, em self/auto).
 */
async function resolveHitOnActor(action, tActor, { damageRoll, atkTotal, defTotal, acertou, cfg }) {
  let dmgText = "";
  let condText = "";
  const dmgTypeLabel = action.damageType ? (cfg.damageTypes?.[action.damageType] || action.damageType) : "";

  if (acertou && damageRoll) {
    let scaling = 0;
    if (action.scalingDamage && Number.isFinite(defTotal)) {
      scaling = Math.floor((atkTotal - defTotal) / 2);
      if (scaling < 0) scaling = 0;
    }
    const resource = action.damageResource || "hp";
    const isHp = resource === "hp";
    const rd = isHp ? damageReductionFor(tActor, action.damageType || "") : 0;
    const dealt = Math.max(0, damageRoll.total + scaling - rd);
    const scaleNote = scaling ? ` <span class="lig-scale">(+${scaling} escalonado)</span>` : "";
    const typeNote = isHp && dmgTypeLabel ? " " + dmgTypeLabel : "";
    const rdNote = rd ? ` <span class="lig-rd">(RD ${rd})</span>` : "";
    const resWord = { hp: "Dano", mp: "Mana drenada", heroic: "Heroico drenado" }[resource];

    const applied = await applyDamageToActor(tActor, dealt, resource);
    let applyNote = "";
    if (applied.applied) {
      const resLabel = { hp: "PV", mp: "PM", heroic: "PH" }[resource];
      const parts = [];
      if (applied.fromTemp) parts.push(`${applied.fromTemp} do PV temp.`);
      applyNote = `<div class="lig-dmg-applied">${resLabel}: ${applied.newValue}/${applied.newMax}${parts.length ? " — " + parts.join(", ") : ""}${applied.downed ? ' <span class="lig-downed">⚠ Caído!</span>' : ""}</div>`;
    } else if (applied.noPermission) {
      applyNote = `<div class="lig-dmg-applied muted">Sem permissão para alterar a ficha do alvo (peça ao Mestre).</div>`;
    }
    dmgText = `<div class="lig-atk-dmg">${resWord}: <strong>${dealt}</strong>${typeNote}${scaleNote}${rdNote}</div>${applyNote}`;
  }

  if (acertou && (action.appliesConditions || []).length) {
    const added = await applyConditionsToActor(tActor, action.appliesConditions);
    if (added.length) {
      condText = `<div class="lig-atk-cond">Condições aplicadas: <strong>${added.join(", ")}</strong></div>`;
    } else if (!tActor.isOwner) {
      condText = `<div class="lig-atk-cond muted">Condições a aplicar: ${action.appliesConditions.join(", ")} (peça ao Mestre)</div>`;
    }
  }
  return dmgText + condText;
}

/**
 * Gasta os custos de uma ação (PM/PV/PH) do personagem que a executa.
 * Desconta do valor de cada recurso (clampando em 0) e devolve o HTML
 * resumindo o gasto. Pago ao executar, independente de acertar.
 * @returns {Promise<string>} HTML do resumo (vazio se não há custo)
 */
export async function spendActionCosts(actor, action) {
  const cfg = [
    { key: "mp", label: "PM", value: Number(action.costMp) || 0 },
    { key: "hp", label: "PV", value: Number(action.costHp) || 0 },
    { key: "heroic", label: "PH", value: Number(action.costHeroic) || 0 },
  ].filter((c) => c.value > 0);
  if (!cfg.length) return "";

  if (!actor.isOwner) {
    return `<div class="lig-cost-line muted">Custo: ${cfg.map((c) => `${c.value} ${c.label}`).join(", ")} (não aplicado)</div>`;
  }

  const update = {};
  const parts = [];
  let insufficient = false;
  for (const c of cfg) {
    const res = actor.system?.resources?.[c.key];
    if (!res) continue;
    const cur = res.value || 0;
    if (cur < c.value) insufficient = true;
    update[`system.resources.${c.key}.value`] = Math.max(0, cur - c.value);
    parts.push(`${c.value} ${c.label}`);
  }
  if (Object.keys(update).length) await actor.update(update);
  return `<div class="lig-cost-line">Custo: ${parts.join(", ")}${insufficient ? ' <span class="lig-insufficient">(recurso insuficiente!)</span>' : ""}</div>`;
}

/**
 * Executa UMA ação de um item. Trata os modos de alvo:
 *   none   — sem alvo (só rolagem/dano anunciado)
 *   self   — afeta o próprio personagem (sem defesa)
 *   target — afeta os alvos mirados (defesa se canRoll)
 *   area   — área: afeta quem está nela (inclui o próprio se ele estiver dentro)
 *   aura   — aura: afeta os outros na área, nunca o próprio (salvo includeSelf)
 *
 * @param {object} opts
 * @param {Actor} opts.actor  ator dono do item
 * @param {Item}  opts.item   item
 * @param {object} opts.action  a entrada de ação (de system.actions)
 * @param {boolean} opts.hidden  rolagem oculta
 */
export async function rollItemAction({ actor, item, action, hidden = false, overrideTargets = null }) {
  const cfg = CONFIG.LIGEIA || {};
  // Compatibilidade: se nenhuma ação for passada, usa a primeira do item.
  if (!action) action = (item.system.actions || [])[0];
  if (!action) {
    ui.notifications?.warn("Este item não tem nenhuma ação configurada.");
    return;
  }

  const mode = action.targetMode || "target";
  const atkKey = action.rollAttr || "forca";
  const lines = [];
  const rolls = [];

  // Gasta os custos da ação (PM/PV/PH) do executor.
  const costText = await spendActionCosts(actor, action);

  // Rolagem de ataque (se a ação rola)
  let atkRoll = null;
  if (action.canRoll) {
    const atk = resolveAttr(actor, atkKey);
    atkRoll = await rollLigeia({
      attribute: atk.value,
      improvement: atk.dice + (Number(action.rollDice) || 0),
      bonus: Number(action.rollBonus) || 0,
      difficulty: null,
    });
    rolls.push(atkRoll.roll);
  }
  const atkLabel = (cfg.attackAttrs?.[atkKey]) || atkKey;
  const atkTotal = atkRoll ? atkRoll.total : 0;

  // Rola dano (uma vez; aplicado a cada alvo afetado)
  let damageRoll = null;
  if (action.damage && String(action.damage).trim()) {
    try { damageRoll = new Roll(String(action.damage)); await damageRoll.evaluate(); rolls.push(damageRoll); }
    catch (e) { damageRoll = null; }
  }

  // Resumo de alcance/área
  const meta = [];
  if (action.range) meta.push(`Alcance ${action.range}m`);
  if (mode === "area" || mode === "aura") {
    meta.push(`${mode === "aura" ? "Aura" : "Área"} ${action.area || 0}m`);
  }
  const metaText = meta.length ? `<span class="lig-act-meta">${meta.join(" · ")}</span>` : "";

  // ---- Monta a lista de alvos afetados conforme o modo ----
  // Se overrideTargets foi passado (ex.: tokens dentro de um template de
  // área/aura), usa-o como fonte de verdade — evita corrida com a atualização
  // assíncrona de game.user.targets.
  const targeted = Array.isArray(overrideTargets)
    ? overrideTargets.filter(Boolean)
    : Array.from(game.user?.targets ?? []).map((t) => t.actor).filter(Boolean);
  const affected = []; // { actor, isSelf }

  if (mode === "self") {
    affected.push({ actor, isSelf: true });
  } else if (mode === "target") {
    for (const a of targeted) affected.push({ actor: a, isSelf: a === actor });
  } else if (mode === "area") {
    // ÁREA: afeta exatamente quem está na área (vindo do targeting). O próprio
    // é incluído naturalmente SE o token dele estiver dentro do círculo.
    for (const a of targeted) affected.push({ actor: a, isSelf: a === actor });
    // Override opcional: forçar incluir o próprio mesmo se estiver fora.
    if (action.includeSelf && !affected.some((x) => x.actor === actor)) {
      affected.push({ actor, isSelf: true });
    }
  } else if (mode === "aura") {
    // AURA: nunca afeta o próprio personagem, mesmo que ele esteja dentro do
    // círculo — a menos que includeSelf esteja explicitamente marcado.
    for (const a of targeted) {
      if (a === actor && !action.includeSelf) continue;
      affected.push({ actor: a, isSelf: a === actor });
    }
  }
  // mode "none": nenhum alvo

  // ---- Resolve cada alvo afetado ----
  if (affected.length) {
    for (const { actor: tActor, isSelf } of affected) {
      // O próprio personagem (self) e modos sem defesa não rolam defesa.
      // Há defesa quando: a ação rola E o modo é target/area/aura E não é o self.
      const needsDefense = action.canRoll && !isSelf && (mode === "target" || mode === "area" || mode === "aura");

      let defTotal = NaN;
      let acertou = true;
      let defInfo = "";

      if (needsDefense) {
        const defKey1 = action.defenseAttr || "esquiva";
        const cand = [resolveAttr(tActor, defKey1)];
        if (action.defenseAttr2 && action.defenseAttr2 !== defKey1) {
          cand.push(resolveAttr(tActor, action.defenseAttr2));
        }
        let def = cand[0];
        for (let i = 1; i < cand.length; i++) if (cand[i].value > def.value) def = cand[i];
        const chooseNote = cand.length > 1
          ? ` <span class="lig-def-choice">(melhor de ${cand.map((c) => cfg.defenseAttrs?.[c.key] || c.key).join(" / ")})</span>`
          : "";
        const defRoll = await rollLigeia({ attribute: def.value, improvement: def.dice, bonus: 0, difficulty: atkTotal });
        rolls.push(defRoll.roll);
        defTotal = defRoll.total;
        acertou = defRoll.total < atkTotal;
        const defLabel = (cfg.defenseAttrs?.[def.key]) || def.key;
        defInfo = ` — defesa ${defLabel}${chooseNote}: ${defRoll.total} ${acertou ? '<span class="lig-outcome ok">Acertou!</span>' : '<span class="lig-outcome ko">Defendeu</span>'}`;
      } else {
        defInfo = isSelf ? ' <span class="lig-outcome self">(em si)</span>' : ' <span class="lig-outcome ok">(automático)</span>';
      }

      const detail = await resolveHitOnActor(action, tActor, { damageRoll, atkTotal, defTotal, acertou, cfg });
      lines.push(`<div class="lig-atk-target"><div class="lig-atk-line"><strong>${tActor.name}</strong>${defInfo}</div>${detail}</div>`);
    }
  } else if (mode === "target") {
    lines.push(`<div class="lig-atk-hint">Selecione um ou mais alvos (target) para resolver a ação.</div>`);
  } else if (mode === "none" && damageRoll) {
    const resource = action.damageResource || "hp";
    const resWord = { hp: "Dano", mp: "Mana drenada", heroic: "Heroico drenado" }[resource];
    const dmgTypeLabel = action.damageType ? (cfg.damageTypes?.[action.damageType] || action.damageType) : "";
    const typeNote = resource === "hp" && dmgTypeLabel ? " " + dmgTypeLabel : "";
    lines.push(`<div class="lig-atk-dmg">${resWord}: <strong>${damageRoll.total}</strong>${typeNote}</div>`);
  }

  // ---- Monta a mensagem ----
  const atkHeader = atkRoll
    ? `<span class="lig-atk-attr">${atkLabel} → ${atkRoll.total}</span>
       ${atkRoll.isCritSuccess ? '<span class="ligeia-crit success">✦ Crítico ✦</span>' : ""}
       ${atkRoll.isCritFail ? '<span class="ligeia-crit fail">✗ Falha Crítica ✗</span>' : ""}`
    : "";

  const flavor = `
    <div class="ligeia-roll-flavor lig-action">
      <strong>${item.name}</strong> <span class="lig-act-name">— ${action.label || "Ação"}</span>
      ${metaText}
      ${costText}
      ${atkHeader}
      ${lines.join("")}
    </div>`;

  const speaker = ChatMessage.getSpeaker({ actor });
  const messageData = { speaker, flavor, rolls, sound: CONFIG.sounds.dice };
  if (hidden) {
    messageData.whisper = ChatMessage.getWhisperRecipients("GM");
    messageData.blind = true;
  }
  return ChatMessage.create(messageData);
}
