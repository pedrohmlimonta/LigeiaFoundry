/**
 * Rolagens automáticas de "fim de efeito" no início do turno.
 *
 * Efeitos aplicados a um personagem (system.appliedEffects) podem ter uma
 * rolagem para encerrar (endRoll). Este helper executa essas rolagens
 * automaticamente no início do turno do personagem — sem o jogador precisar
 * clicar no botão 🎲. Em caso de sucesso (≥ CD), o efeito é removido (e a
 * condição associada, se houver).
 *
 * O processamento roda em um único cliente (o GM responsável) para evitar
 * rolagens/remoções duplicadas em mesa com vários jogadores.
 */

import { rollLigeia, resolveAttr, rerollFor, critFor, applyHealingToActor } from "./dice.mjs";

/** Detecta se ESTE cliente deve processar (apenas um GM ativo). */
function isResponsibleClient() {
  const activeGMs = game.users.filter((u) => u.isGM && u.active);
  if (!activeGMs.length) return game.user.isGM;
  const responsible = activeGMs.sort((a, b) => a.id.localeCompare(b.id))[0];
  return responsible?.id === game.user.id;
}

/**
 * Executa a rolagem de fim de UM efeito aplicado, postando o resultado.
 * @returns {boolean} true se o efeito encerrou (sucesso).
 */
async function rollEndForEffect(actor, ae) {
  const attrKey = ae.endRoll?.attr || "mente";
  const r = resolveAttr(actor, attrKey);
  const rm = actor.system?.rollMods || {};
  const rr = rerollFor(actor, attrKey);
  const cr = critFor(actor, attrKey);

  // CD do teste: normalmente fixa (endRoll.dc). No modo "refazer", o ATACANTE
  // rola o atributo do ataque de novo para gerar a CD fresca desta rodada
  // (rolagem resistida — ignora alcance, é só o contraste de atributos).
  let dc = ae.endRoll?.dc || 0;
  let atkNote = "";
  if (ae.endRoll?.reroll && ae.endRoll?.attackerUuid) {
    let attacker = null;
    try { attacker = await fromUuid(ae.endRoll.attackerUuid); } catch (e) { attacker = null; }
    // fromUuid pode devolver um token/ator; normaliza para o ator.
    if (attacker?.actor) attacker = attacker.actor;
    if (attacker) {
      const aKey = ae.endRoll.attackerAttr || "forca";
      const aR = resolveAttr(attacker, aKey);
      const aRm = attacker.system?.rollMods || {};
      const aRr = rerollFor(attacker, aKey, "attack");
      const aCr = critFor(attacker, aKey, "attack");
      const atkRoll = await rollLigeia({
        attribute: aR.value,
        improvement: aR.dice + (aRm.all?.dice || 0) + (aRm.attack?.dice || 0),
        bonus: (aRm.all?.bonus || 0) + (aRm.attack?.bonus || 0),
        reroll1: aRr.reroll1, reroll6: aRr.reroll6,
        critBonus: aCr.critBonus, failBonus: aCr.failBonus,
      });
      dc = atkRoll.total;
      const aLabel = (CONFIG.LIGEIA?.attackAttrs?.[aKey]) || aKey;
      atkNote = ` <span class="lig-dc-note">(CD refeita: ${attacker.name} ${aLabel} → ${dc})</span>`;
      // Mostra também os dados do atacante na mensagem.
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        flavor: `<div class="ligeia-roll-flavor"><strong>${attacker.name}</strong> — mantém <em>${ae.label}</em> sobre ${actor.name} (${aLabel} → ${dc})</div>`,
        rolls: [atkRoll.roll],
        sound: CONFIG.sounds.dice,
      });
    }
  }

  const result = await rollLigeia({
    attribute: r.value,
    improvement: r.dice + (rm.all?.dice || 0),
    bonus: rm.all?.bonus || 0,
    difficulty: dc,
    reroll1: rr.reroll1,
    reroll6: rr.reroll6,
    critBonus: cr.critBonus,
    failBonus: cr.failBonus,
  });
  const success = result.total >= dc;
  const label = (CONFIG.LIGEIA?.attackAttrs?.[attrKey]) || attrKey;
  const note = success
    ? `<span class="lig-outcome ok">Encerrou!</span>`
    : `<span class="lig-outcome ko">Persiste</span>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="ligeia-roll-flavor"><strong>${actor.name}</strong> — encerrar <em>${ae.label}</em> (início do turno · ${label} vs CD ${dc}${atkNote}): ${result.total} ${note}</div>`,
    rolls: [result.roll],
    sound: CONFIG.sounds.dice,
  });
  return success;
}

/**
 * REGENERAÇÃO no início do turno: efeitos aplicados com tickHeal recuperam
 * o recurso do portador enquanto durarem (contraparte do dano contínuo).
 * Efeitos desligados (disabled) não regeneram.
 */
export async function processRegenAtTurnStart(actor) {
  if (!actor) return;
  for (const ae of actor.system?.appliedEffects || []) {
    if (ae?.disabled) continue;
    const th = ae?.tickHeal || {};
    const amount = Number(th.amount) || 0;
    if (amount <= 0) continue;
    const resource = th.resource || "hp";
    const applied = await applyHealingToActor(actor, amount, resource);
    const resLabel = { hp: "PV", mp: "PM", heroic: "PH" }[resource];
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="ligeia-roll-flavor"><strong>${actor.name}</strong> — <em>${ae.label}</em>: <span class="lig-atk-heal">regenera <strong>${amount}</strong> ${resLabel}</span>${applied.applied ? ` (${resLabel}: ${applied.newValue}/${applied.newMax})` : ""}</div>`,
    });
  }
}

/**
 * Processa TODAS as rolagens de fim de efeito de um ator (as que estão
 * habilitadas e não desativadas). Remove os efeitos que encerrarem, junto das
 * condições associadas. Faz uma única atualização ao final.
 */
export async function processEndRollsAtTurnStart(actor) {
  if (!actor) return;
  const arr = foundry.utils.deepClone(actor.system?.appliedEffects || []);
  if (!arr.length) return;

  // Índices a remover (efeitos que encerraram).
  const toRemove = [];
  for (let i = 0; i < arr.length; i++) {
    const ae = arr[i];
    if (!ae?.endRoll?.enabled) continue;
    if (ae.disabled) continue; // efeito desligado não rola
    const ended = await rollEndForEffect(actor, ae);
    if (ended) toRemove.push(i);
  }
  if (!toRemove.length) return;

  // Monta o novo array sem os encerrados e limpa condições associadas.
  const removeSet = new Set(toRemove);
  const conditionsToClear = new Set(
    toRemove.map((i) => arr[i].conditionId).filter(Boolean)
  );
  const newArr = arr.filter((_, i) => !removeSet.has(i));
  const upd = { "system.appliedEffects": newArr };
  if (conditionsToClear.size) {
    upd["system.conditions"] = (actor.system?.conditions || []).filter(
      (c) => !conditionsToClear.has(c)
    );
  }
  await actor.update(upd);
}

/**
 * Rola o fim de UM efeito aplicado (por índice) e, em caso de sucesso, remove
 * o efeito e a condição associada. Usada tanto pelo botão manual da ficha
 * quanto (indiretamente) pelo processamento automático de turno.
 */
export async function rollSingleEndEffect(actor, idx) {
  const arr = foundry.utils.deepClone(actor.system?.appliedEffects || []);
  const ae = arr[idx];
  if (!ae || !ae.endRoll?.enabled) return false;
  const ended = await rollEndForEffect(actor, ae);
  if (!ended) return false;
  arr.splice(idx, 1);
  const upd = { "system.appliedEffects": arr };
  if (ae.conditionId) {
    upd["system.conditions"] = (actor.system?.conditions || []).filter((c) => c !== ae.conditionId);
  }
  await actor.update(upd);
  return true;
}

/** Registra o hook de início de turno para as rolagens de fim de efeito. */
export function registerTurnEffectHooks() {
  Hooks.on("updateCombat", async (combat, changed, options, userId) => {
    if (!isResponsibleClient()) return;
    // Só quando o turno (ou a rodada, que muda o combatente) avança.
    const turnChanged =
      Object.prototype.hasOwnProperty.call(changed, "turn") ||
      Object.prototype.hasOwnProperty.call(changed, "round");
    if (!turnChanged) return;
    const actor = combat.combatant?.actor;
    if (!actor) return;
    // Regeneração primeiro: o efeito ainda está ativo no início do turno,
    // mesmo que uma rolagem de fim o encerre logo em seguida.
    await processRegenAtTurnStart(actor);
    await processEndRollsAtTurnStart(actor);
  });
}
