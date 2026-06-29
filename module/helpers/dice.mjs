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
 * Pequena pausa (ms). Usada para separar a rolagem de ataque da de defesa,
 * dando a sensação de duas rolagens distintas.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera o tempo aproximado da animação 3D dos dados (Dice So Nice), se
 * estiver ativo, com um pequeno respiro adicional. Cai num delay fixo caso
 * o módulo não esteja presente.
 */
async function waitForDiceAnimation(fallbackMs = 1100) {
  const dsn = game.modules?.get?.("dice-so-nice")?.active;
  if (!dsn) {
    await delay(600);
    return;
  }
  await delay(fallbackMs);
}

import { conditionModifiers } from "./conditions.mjs";
import { playAutomatedAnimation } from "./integrations.mjs";

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
  reroll1 = 0,
  reroll6 = 0,
  critBonus = 0,
  failBonus = 0,
} = {}) {
  // Dados de melhoria: positivo = vantagem (mantém os 2 MAIORES);
  // negativo = desvantagem (rola os mesmos dados extras e mantém os 2
  // MENORES). Ex.: -1D → 3d6kl2. Sempre ao menos 2d6.
  const extra = Math.abs(improvement || 0);
  const totalDice = 2 + extra;
  const keepMode = (improvement || 0) < 0 ? "kl2" : "kh2";
  const flat = (attribute || 0) + (bonus || 0);

  // ----- Reroll de dados (1 e/ou 6) -----
  // Aplicamos o reroll SEMPRE manualmente após a rolagem (tanto para um
  // número limitado quanto para "todos"). Evitamos os modificadores nativos
  // do Foundry porque nesta build o `ro` não parseia o número corretamente
  // (acaba rerolando 1s). O caminho manual rerola cada dado-alvo uma vez,
  // respeitando a contagem ou "todos" (Infinity).
  const r1All = reroll1 === "all" || reroll1 === Infinity;
  const r6All = reroll6 === "all" || reroll6 === Infinity;
  const r1Count = r1All ? Infinity : Math.max(0, Number(reroll1) || 0);
  const r6Count = r6All ? Infinity : Math.max(0, Number(reroll6) || 0);

  const formulaParts = [`${totalDice}d6${keepMode}`];
  if (flat !== 0) formulaParts.push(`${flat >= 0 ? "+" : "-"} ${Math.abs(flat)}`);
  const formula = formulaParts.join(" ");

  const roll = new Roll(formula);
  await roll.evaluate();

  // Reroll manual (contagem OU todos). Reaproveita o termo de dados do roll,
  // troca os resultados marcados e recalcula o total preservando o modo de
  // manter (kh2/kl2).
  const dieTerm0 = roll.dice[0];
  if (dieTerm0 && (r1Count > 0 || r6Count > 0)) {
    await applyLimitedReroll(dieTerm0, { ones: r1Count, sixes: r6Count });
    // Recalcula quais dados ficam ativos (kh2/kl2) e o total da rolagem.
    recomputeKeep(dieTerm0, keepMode);
    // Atualiza o total do Roll somando o termo de dados + flat.
    roll._total = sumKept(dieTerm0) + flat;
  }

  // Extrai os dados individuais
  const dieTerm = roll.dice[0];
  const results = dieTerm ? dieTerm.results : [];
  const kept = results.filter((r) => r.active).map((r) => r.result);
  const dropped = results.filter((r) => !r.active).map((r) => r.result);

  // Crítico avaliado nos dados que entram na soma (os 2 maiores)
  // Crítico avaliado pela SOMA dos dados que entram na rolagem (os 2
  // mantidos), considerando apenas os dados (não soma atributo/bônus).
  //  - Crítico de sucesso: soma dos 2 dados ≥ (12 − critBonus). Padrão
  //    crita só com 12 (6+6); "crítico aprimorado" reduz o limiar (11, 10…).
  //  - Falha crítica: soma dos 2 dados ≤ (2 + failBonus). Padrão falha só
  //    com 2 (1+1); "falha piorada" aumenta o limiar (3, 4…).
  const keptSum = kept.reduce((s, v) => s + v, 0);
  const critThreshold = 12 - Math.max(0, Number(critBonus) || 0);
  const failThreshold = 2 + Math.max(0, Number(failBonus) || 0);
  const isCritSuccessDice = kept.length >= 2 && keptSum >= critThreshold;
  const isCritFail = kept.length >= 2 && keptSum <= failThreshold;

  const total = roll.total;

  let outcome = null;
  if (difficulty != null) {
    outcome = total >= difficulty ? "success" : "fail";
  }

  // Sucesso crítico só vale se igualar/superar a dificuldade (quando há uma).
  // Sem dificuldade, atingir o limiar de dados já conta como crítico.
  const isCritSuccess =
    isCritSuccessDice && (difficulty == null || total >= difficulty);

  // Se os limiares se sobrepõem (config extrema), o sucesso crítico tem
  // prioridade: não marca falha crítica ao mesmo tempo.
  const isCritFailFinal = isCritFail && !isCritSuccessDice;

  return {
    roll,
    kept,
    dropped,
    total,
    isCritSuccess,
    isCritFail: isCritFailFinal,
    outcome,
    difficulty,
    flat,
    totalDice,
  };
}

/**
 * Reroll manual com contagem limitada. Para cada dado que mostra o valor
 * alvo (1 e/ou 6), até o limite informado, marca o resultado original como
 * descartado por reroll e adiciona um novo resultado no lugar.
 * @param {DiceTerm} dieTerm  termo de dados (d6) já avaliado
 * @param {{ones:number, sixes:number}} limits  quantos rerrolar de cada
 */
async function applyLimitedReroll(dieTerm, { ones = 0, sixes = 0 } = {}) {
  let remainingOnes = ones === Infinity ? Infinity : ones;
  let remainingSixes = sixes === Infinity ? Infinity : sixes;
  const faces = dieTerm.faces || 6;
  const newResults = [];
  for (const res of dieTerm.results) {
    // Só rerrola dados ainda válidos (não descartados/já rerrolados).
    if (res.rerolled || res.discarded) { newResults.push(res); continue; }
    let doReroll = false;
    if (res.result === 1 && remainingOnes > 0) { doReroll = true; if (remainingOnes !== Infinity) remainingOnes--; }
    else if (res.result === 6 && remainingSixes > 0) { doReroll = true; if (remainingSixes !== Infinity) remainingSixes--; }

    if (doReroll) {
      res.rerolled = true;
      res.active = false; // o valor original sai da soma
      newResults.push(res);
      // Novo dado no lugar
      const newVal = Math.ceil(CONFIG.Dice.randomUniform() * faces);
      newResults.push({ result: newVal, active: true });
    } else {
      newResults.push(res);
    }
  }
  dieTerm.results = newResults;
}

/**
 * Recalcula quais resultados ficam "ativos" segundo o modo de manter
 * (kh2 = 2 maiores; kl2 = 2 menores), considerando apenas os dados não
 * rerrolados (os rerrolados já estão com active=false).
 */
function recomputeKeep(dieTerm, keepMode) {
  const live = dieTerm.results.filter((r) => !r.rerolled);
  // Ordena por valor
  const sorted = [...live].sort((a, b) => a.result - b.result);
  const keep = keepMode === "kl2" ? sorted.slice(0, 2) : sorted.slice(-2);
  const keepSet = new Set(keep);
  for (const r of live) r.active = keepSet.has(r);
}

/** Soma os resultados ativos de um termo de dados. */
function sumKept(dieTerm) {
  return dieTerm.results.filter((r) => r.active).reduce((s, r) => s + r.result, 0);
}

/**
 * Combina dois valores de reroll (número ≥0 ou "all"/Infinity). "all" vence.
 */
function mergeReroll(a, b) {
  const aAll = a === "all" || a === Infinity;
  const bAll = b === "all" || b === Infinity;
  if (aAll || bAll) return Infinity;
  return (Number(a) || 0) + (Number(b) || 0);
}

/**
 * Calcula o reroll (1s e 6s) efetivo para uma rolagem de um ator, combinando:
 *  - o reroll do atributo/secundário (attrReroll[key])
 *  - o reroll da categoria "all" (todas as rolagens)
 *  - o reroll da categoria extra informada ("attack" ou "defense"), se houver
 * @returns {{reroll1:(number|'all'), reroll6:(number|'all')}}
 */
export function rerollFor(actor, key, category = null) {
  const ar = actor?.system?.attrReroll?.[key] || {};
  const rm = actor?.system?.rollMods || {};
  let r1 = mergeReroll(ar.reroll1 || 0, rm.all?.reroll1 || 0);
  let r6 = mergeReroll(ar.reroll6 || 0, rm.all?.reroll6 || 0);
  if (category && rm[category]) {
    r1 = mergeReroll(r1, rm[category].reroll1 || 0);
    r6 = mergeReroll(r6, rm[category].reroll6 || 0);
  }
  return { reroll1: r1 === Infinity ? "all" : r1, reroll6: r6 === Infinity ? "all" : r6 };
}

/**
 * Calcula o crítico aprimorado (critBonus) e a falha piorada (failBonus)
 * efetivos para uma rolagem, combinando o atributo + categoria "all" +
 * categoria extra ("attack"/"defense").
 * @returns {{critBonus:number, failBonus:number}}
 */
export function critFor(actor, key, category = null) {
  const ac = actor?.system?.attrCrit?.[key] || {};
  const rm = actor?.system?.rollMods || {};
  let critBonus = (ac.critBonus || 0) + (rm.all?.critBonus || 0);
  let failBonus = (ac.failBonus || 0) + (rm.all?.failBonus || 0);
  if (category && rm[category]) {
    critBonus += rm[category].critBonus || 0;
    failBonus += rm[category].failBonus || 0;
  }
  return { critBonus, failBonus };
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
    // Os dados de melhoria dos secundários já vêm calculados em
    // prepareDerivedData (herdam do primário + efeitos). Fallback ao primário.
    const diceMap = {
      bloqueio: sec.bloqueioDice ?? sys.attributes?.forca?.dice ?? 0,
      esquiva: sec.esquivaDice ?? sys.attributes?.agilidade?.dice ?? 0,
      conjuracao: sec.conjuracaoDice ?? sys.attributes?.mente?.dice ?? 0,
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
  // Efeitos aplicados na ficha (buffs de resistência) também contam.
  for (const ae of actor.system?.appliedEffects || []) {
    if (ae.disabled) continue;
    for (const e of ae.effects || []) {
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
async function resolveHitOnActor(action, tActor, { damageRoll, atkTotal, defTotal, acertou, cfg, attackerMods, caster }) {
  let dmgText = "";
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

    // Multiplicadores de condição:
    //  - Enfraquecido (atacante): causa metade do dano
    //  - Intangível (alvo): recebe metade do dano
    const targetMods = conditionModifiers(tActor);
    const dealtMult = (attackerMods?.damageDealtMult ?? 1);
    const takenMult = targetMods.damageTakenMult;

    // raw → aplica enfraquecido → subtrai RD → aplica intangível
    let amount = (damageRoll.total + scaling) * dealtMult;
    amount = amount - rd;
    amount = amount * takenMult;
    const dealt = Math.max(0, Math.floor(amount));

    const scaleNote = scaling ? ` <span class="lig-scale">(+${scaling} escalonado)</span>` : "";
    const typeNote = isHp && dmgTypeLabel ? " " + dmgTypeLabel : "";
    const rdNote = rd ? ` <span class="lig-rd">(RD ${rd})</span>` : "";
    const multBits = [];
    if (dealtMult !== 1) multBits.push("½ Enfraquecido");
    if (takenMult !== 1) multBits.push("½ Intangível");
    const multNote = multBits.length ? ` <span class="lig-cond-note">(${multBits.join(", ")})</span>` : "";
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
    dmgText = `<div class="lig-atk-dmg">${resWord}: <strong>${dealt}</strong>${typeNote}${scaleNote}${rdNote}${multNote}</div>${applyNote}`;
  }

  // Aplica EFEITOS (buffs/debuffs/condições) ao alvo quando acerta.
  let fxText = "";
  const fxList = action.appliesEffects || [];
  if (acertou && fxList.length) {
    if (tActor.isOwner) {
      const cur = foundry.utils.deepClone(tActor.system?.appliedEffects || []);
      const conds = foundry.utils.deepClone(tActor.system?.conditions || []);
      const condsBefore = conds.length;
      const names = [];
      for (const ae of fxList) {
        const isCondition = ae.fxType === "condition";
        const condId = isCondition ? (ae.fxTarget || "") : "";
        // Tipos que viram modificador no array effects
        let effects = [];
        if (!isCondition && ((Number(ae.fxValue) || 0) !== 0 || ae.fxAll)) {
          const eff = { type: ae.fxType || "bonus", target: ae.fxTarget || "all", value: Number(ae.fxValue) || 0, enabled: true };
          // Para dano/RD, o "alvo" é o tipo de dano.
          if (ae.fxType === "damage" || ae.fxType === "rd") eff.damageType = ae.fxTarget || "";
          // Para reroll, propaga a flag "todos".
          if (ae.fxType === "reroll1" || ae.fxType === "reroll6") eff.rerollAll = !!ae.fxAll;
          effects = [eff];
        }
        // Ativa a condição no alvo (marcador), se for o caso.
        if (isCondition && condId && !conds.includes(condId)) conds.push(condId);

        const rounds = ae.durationMode === "rounds" ? (ae.durationRounds || 0) : 0;
        const condLabel = CONFIG.LIGEIA?.conditions?.[condId]?.label || condId;
        cur.push({
          label: ae.label || (isCondition ? condLabel : "Efeito"),
          icon: isCondition ? (CONFIG.LIGEIA?.conditions?.[condId]?.icon || "icons/svg/aura.svg") : "icons/svg/aura.svg",
          effects,
          conditionId: condId,
          disabled: false,
          duration: { rounds, remaining: rounds }, // rounds 0 = até o fim da cena
          endRoll: {
            enabled: !!ae.resist,
            attr: ae.resistAttr || "vigor",
            dc: ae.resistVsCast ? atkTotal : (ae.resistDc || 0),
            vsCast: !!ae.resistVsCast,
          },
          tickDamage: { amount: ae.tickAmount || 0, type: ae.tickType || "", resource: ae.tickResource || "hp" },
          source: caster?.name || "",
        });
        names.push(ae.label || (isCondition ? condLabel : "Efeito"));
      }
      const update = { "system.appliedEffects": cur };
      if (conds.length !== condsBefore) update["system.conditions"] = conds;
      await tActor.update(update);
      fxText = `<div class="lig-atk-fx">Efeitos aplicados: <strong>${names.join(", ")}</strong></div>`;
    } else {
      fxText = `<div class="lig-atk-fx muted">Efeitos a aplicar: ${fxList.map((e) => e.label || "Efeito").join(", ")} (peça ao Mestre)</div>`;
    }
  }

  return dmgText + fxText;
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
/**
 * Executa a macro vinculada a uma ação, se houver UUID e estiver ativa.
 * A macro recebe um escopo com referências úteis (actor, item, action,
 * token, alvos), além do contexto padrão do Foundry (speaker, character).
 */
async function executeActionMacro({ actor, item, action, overrideTargets = null }) {
  if (!action?.macroUuid || action.macroEnabled === false) return;
  let macro;
  try {
    macro = await fromUuid(action.macroUuid);
  } catch (e) {
    macro = null;
  }
  if (!macro) {
    ui.notifications?.warn(`Macro da ação "${action.label || ""}" não encontrada.`);
    return;
  }
  try {
    const token = actor?.getActiveTokens?.()?.[0] ?? null;
    const speaker = ChatMessage.getSpeaker({ actor });
    const targets = overrideTargets ?? Array.from(game.user?.targets ?? []).map((t) => t.actor);
    // O escopo é injetado como variáveis disponíveis dentro da macro.
    await macro.execute({
      actor,
      item,
      action,
      token,
      speaker,
      targets,
      character: game.user?.character ?? null,
    });
  } catch (err) {
    console.error("Ligeia | erro ao executar macro da ação:", err);
    ui.notifications?.error(`Erro ao executar a macro "${macro.name}". Veja o console.`);
  }
}

export async function rollItemAction({ actor, item, action, hidden = false, overrideTargets = null, frozenAttackTotal = null }) {
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
  const atkRolls = []; // ataque + dano (1ª mensagem)
  const defRolls = []; // defesas dos alvos (2ª mensagem)

  // Modo "ataque congelado": disparos por turno de uma emanação NÃO re-rolam
  // o ataque; usam o total da rolagem feita na criação da área como CD.
  const isFrozen = frozenAttackTotal != null;

  // Gasta os custos da ação (PM/PV/PH) do executor.
  const costText = await spendActionCosts(actor, action);

  // Executa a macro vinculada à ação (se houver e estiver ativa).
  await executeActionMacro({ actor, item, action, overrideTargets });

  // Rolagem de ataque (se a ação rola)
  // Modificadores de condição do ATACANTE
  const atkCond = conditionModifiers(actor);

  // A ação rola se faz ataque OU se testa contra dificuldade fixa.
  const rollsDice = action.canRoll || action.vsDifficulty;
  const fixedDC = action.vsDifficulty ? (Number(action.fixedDifficulty) || 0) : null;

  let atkRoll = null;
  if (rollsDice && !isFrozen) {
    const atk = resolveAttr(actor, atkKey);
    // Modificadores de categoria de rolagem do atacante (all + attack)
    const rm = actor.system?.rollMods || {};
    const rmDice = (rm.all?.dice || 0) + (rm.attack?.dice || 0);
    const rmBonus = (rm.all?.bonus || 0) + (rm.attack?.bonus || 0);
    const atkRr = rerollFor(actor, atkKey, "attack");
    const atkCrit = critFor(actor, atkKey, "attack");
    atkRoll = await rollLigeia({
      attribute: atk.value,
      improvement: atk.dice + (Number(action.rollDice) || 0) + atkCond.atkDice + rmDice,
      bonus: (Number(action.rollBonus) || 0) + rmBonus,
      // Passa a CD fixa (quando houver) para marcar sucesso/falha e crítico.
      difficulty: fixedDC,
      reroll1: atkRr.reroll1,
      reroll6: atkRr.reroll6,
      critBonus: atkCrit.critBonus,
      failBonus: atkCrit.failBonus,
    });
    atkRolls.push(atkRoll.roll);
  }
  const atkLabel = (cfg.attackAttrs?.[atkKey]) || atkKey;
  // Total do ataque: o congelado (emanação por turno) ou o recém-rolado.
  const atkTotal = isFrozen ? Number(frozenAttackTotal) || 0 : (atkRoll ? atkRoll.total : 0);

  // Dificuldade fixa: a CD efetiva por alvo pode somar um atributo do alvo.
  // "nenhum" (ou vazio) = só a CD base. Calculada por alvo dentro do loop.
  const dcAttr = action.difficultyAttr || "nenhum";
  const dcUsesAttr = fixedDC != null && dcAttr && dcAttr !== "nenhum";
  const dcAttrLabel = dcUsesAttr
    ? (cfg.attackAttrs?.[dcAttr] || cfg.defenseAttrs?.[dcAttr] || dcAttr)
    : "";
  /**
   * CD efetiva contra um alvo específico (base + atributo do alvo, se houver).
   * Sem alvo (tActor null) ou "nenhum", retorna a CD base.
   */
  const effectiveDCFor = (tActor) => {
    if (fixedDC == null) return null;
    if (!dcUsesAttr || !tActor) return fixedDC;
    const a = resolveAttr(tActor, dcAttr);
    return fixedDC + (a?.value || 0);
  };
  // passedDC base (sem alvo) — usado no cabeçalho de modos sem defesa.
  const passedDC = fixedDC == null ? true : atkTotal >= fixedDC;
  const atkCondNote = atkCond.atkDice ? ` <span class="lig-cond-note">(${atkCond.atkDice}D por condição)</span>` : "";

  // Rola dano (uma vez; aplicado a cada alvo afetado)
  let damageRoll = null;
  if (action.damage && String(action.damage).trim()) {
    try { damageRoll = new Roll(String(action.damage)); await damageRoll.evaluate(); atkRolls.push(damageRoll); }
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

  // Integração com Automated Animations: dispara a animação configurada para
  // o item (se o módulo estiver instalado e o item configurado nele). Não
  // bloqueia o resto da resolução (fire-and-forget).
  playAutomatedAnimation({
    actor,
    item,
    action,
    targetActors: affected.filter((x) => !x.isSelf).map((x) => x.actor),
  });

  // Cabeçalho do ataque (atacante) — usado na 1ª mensagem.
  // Mostra o resultado da CD no cabeçalho apenas quando NÃO há alvos
  // afetados (ex.: modo "Nenhum", ou nenhum alvo selecionado). Havendo
  // alvos, cada um exibe sua própria CD efetiva na linha do alvo.
  const showDCInHeader = fixedDC != null && affected.length === 0;
  const dcHeader = showDCInHeader
    ? ` <span class="lig-dc-note">vs CD ${fixedDC}: ${passedDC ? '<span class="lig-outcome ok">Sucesso!</span>' : '<span class="lig-outcome ko">Falhou</span>'}</span>`
    : "";
  const atkHeader = atkRoll
    ? `<span class="lig-atk-attr">${atkLabel} → ${atkRoll.total}${atkCondNote}${dcHeader}</span>
       ${atkRoll.isCritSuccess ? '<span class="ligeia-crit success">✦ Crítico ✦</span>' : ""}
       ${atkRoll.isCritFail ? '<span class="ligeia-crit fail">✗ Falha Crítica ✗</span>' : ""}`
    : (isFrozen
        ? `<span class="lig-atk-attr lig-emanation-tag">Emanação · CD ${atkTotal} (ataque da criação)</span>`
        : "");
  const speaker = ChatMessage.getSpeaker({ actor });
  const whisperData = hidden
    ? { whisper: ChatMessage.getWhisperRecipients("GM"), blind: true }
    : {};

  // Determina se HAVERÁ rolagem de defesa (algum alvo que não seja o próprio,
  // num modo com defesa). Só nesse caso separamos em duas mensagens com delay.
  const willDefend = action.canRoll
    && (mode === "target" || mode === "area" || mode === "aura")
    && affected.some((x) => !x.isSelf);

  // Se haverá defesa, posta PRIMEIRO o ataque (e o dano) numa mensagem
  // própria, espera a animação dos dados e só então rola/posta as defesas —
  // dando a sensação de duas rolagens distintas.
  if (willDefend && atkRoll) {
    const atkFlavor = `
      <div class="ligeia-roll-flavor lig-action">
        <strong>${item.name}</strong> <span class="lig-act-name">— ${action.label || "Ação"}</span>
        ${metaText}
        ${costText}
        ${atkHeader}
        <div class="lig-atk-hint">Resolvendo defesa…</div>
      </div>`;
    await ChatMessage.create({ speaker, flavor: atkFlavor, rolls: atkRolls, sound: CONFIG.sounds.dice, ...whisperData });
    await waitForDiceAnimation();
  }

  // ---- Resolve cada alvo afetado ----
  if (affected.length) {
    for (const { actor: tActor, isSelf } of affected) {
      // Há defesa quando: a ação faz ATAQUE E o modo é target/area/aura E não é o self.
      const needsDefense = action.canRoll && !isSelf && (mode === "target" || mode === "area" || mode === "aura");

      let defTotal = NaN;
      let acertou = true;
      let defInfo = "";

      if (needsDefense) {
        const defCond = conditionModifiers(tActor);

        // Monta as defesas candidatas; Indefeso não pode usar Bloqueio.
        let keys = [action.defenseAttr || "esquiva"];
        if (action.defenseAttr2 && action.defenseAttr2 !== keys[0]) keys.push(action.defenseAttr2);
        if (defCond.blockDisabled) {
          const filtered = keys.filter((k) => k !== "bloqueio");
          keys = filtered.length ? filtered : ["esquiva"]; // só tinha bloqueio → vira esquiva
        }

        // Resolve cada candidata aplicando o modificador de Esquiva (-3 se
        // Indefeso) ao VALOR, e escolhe a de maior valor efetivo.
        const cands = keys.map((k) => {
          const r = resolveAttr(tActor, k);
          const penalty = k === "esquiva" ? defCond.esquivaMod : 0;
          return { key: k, base: r.value, dice: r.dice, penalty, eff: r.value + penalty };
        });
        let def = cands[0];
        for (let i = 1; i < cands.length; i++) if (cands[i].eff > def.eff) def = cands[i];

        const chooseNote = cands.length > 1
          ? ` <span class="lig-def-choice">(melhor de ${cands.map((c) => cfg.defenseAttrs?.[c.key] || c.key).join(" / ")})</span>`
          : "";

        const defRr = rerollFor(tActor, def.key, "defense");
        const defCrit = critFor(tActor, def.key, "defense");
        const defRoll = await rollLigeia({
          attribute: def.base,
          improvement: def.dice + defCond.defDice + (tActor.system?.rollMods?.all?.dice || 0) + (tActor.system?.rollMods?.defense?.dice || 0),
          bonus: def.penalty + (tActor.system?.rollMods?.all?.bonus || 0) + (tActor.system?.rollMods?.defense?.bonus || 0),
          difficulty: atkTotal,
          reroll1: defRr.reroll1,
          reroll6: defRr.reroll6,
          critBonus: defCrit.critBonus,
          failBonus: defCrit.failBonus,
        });
        defRolls.push(defRoll.roll);
        defTotal = defRoll.total;
        // Supera a defesa E (se houver) a dificuldade fixa (CD efetiva do alvo).
        const beatDefense = defRoll.total < atkTotal;
        const tgtDC = effectiveDCFor(tActor);
        const passedTgtDC = tgtDC == null ? true : atkTotal >= tgtDC;
        acertou = beatDefense && passedTgtDC;
        const defLabel = (cfg.defenseAttrs?.[def.key]) || def.key;
        // Notas de condição na defesa
        const condBits = [];
        if (def.penalty) condBits.push(`${def.penalty} Esquiva (Indefeso)`);
        if (defCond.defDice) condBits.push(`${defCond.defDice}D`);
        if (defCond.blockDisabled && (action.defenseAttr === "bloqueio" || action.defenseAttr2 === "bloqueio")) {
          condBits.push("sem Bloqueio");
        }
        const condNote = condBits.length ? ` <span class="lig-cond-note">(${condBits.join(", ")})</span>` : "";
        // Nota da CD fixa quando também é exigida (mostra a CD efetiva e, se
        // somou atributo do alvo, detalha base + atributo).
        const dcNote = tgtDC != null
          ? ` <span class="lig-dc-note">[CD ${tgtDC}${dcUsesAttr ? ` = ${fixedDC}+${dcAttrLabel}` : ""}: ${passedTgtDC ? "ok" : "falhou"}]</span>`
          : "";
        let outcomeTag;
        if (acertou) outcomeTag = '<span class="lig-outcome ok">Acertou!</span>';
        else if (!beatDefense) outcomeTag = '<span class="lig-outcome ko">Defendeu</span>';
        else outcomeTag = '<span class="lig-outcome ko">Não superou a CD</span>';
        defInfo = ` — defesa ${defLabel}${chooseNote}: ${defRoll.total}${condNote}${dcNote} ${outcomeTag}`;
      } else if (fixedDC != null) {
        // Sem defesa, mas testa contra dificuldade fixa (CD efetiva do alvo).
        const tgtDC = effectiveDCFor(tActor);
        const passedTgtDC = atkTotal >= tgtDC;
        acertou = passedTgtDC;
        const dcDetail = dcUsesAttr ? ` (${fixedDC}+${dcAttrLabel})` : "";
        defInfo = ` — CD ${tgtDC}${dcDetail}: ${atkTotal} ${passedTgtDC ? '<span class="lig-outcome ok">Sucesso!</span>' : '<span class="lig-outcome ko">Falhou</span>'}`;
      } else {
        defInfo = isSelf ? ' <span class="lig-outcome self">(em si)</span>' : ' <span class="lig-outcome ok">(automático)</span>';
      }

      const detail = await resolveHitOnActor(action, tActor, { damageRoll, atkTotal, defTotal, acertou, cfg, attackerMods: atkCond, caster: actor });
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

  // ---- Monta a mensagem final ----
  if (willDefend && atkRoll) {
    // Já postamos o ataque; esta 2ª mensagem traz as defesas e resultados.
    const defFlavor = `
      <div class="ligeia-roll-flavor lig-action lig-action-resolve">
        <span class="lig-act-name">${item.name} — ${action.label || "Ação"} · resultado (ataque ${atkRoll.total})</span>
        ${lines.join("")}
      </div>`;
    const msg = await ChatMessage.create({ speaker, flavor: defFlavor, rolls: defRolls, sound: CONFIG.sounds.dice, ...whisperData });
    return { message: msg, atkTotal, atkRolled: !!atkRoll };
  }

  // Caso sem defesa: uma mensagem única com tudo.
  const flavor = `
    <div class="ligeia-roll-flavor lig-action">
      <strong>${item.name}</strong> <span class="lig-act-name">— ${action.label || "Ação"}</span>
      ${metaText}
      ${costText}
      ${atkHeader}
      ${lines.join("")}
    </div>`;
  const msg = await ChatMessage.create({ speaker, flavor, rolls: [...atkRolls, ...defRolls], sound: CONFIG.sounds.dice, ...whisperData });
  return { message: msg, atkTotal, atkRolled: !!atkRoll };
}
