/**
 * Sobrevida VINCULADA (barreiras) — efeitos aplicados com tempHp > 0.
 *
 * Um efeito aplicado (system.appliedEffects) pode conceder sobrevida ao ser
 * aplicado (campo tempHp). A sobrevida e o efeito ficam LIGADOS:
 *  - Se a sobrevida do personagem chegar a 0 (por dano ou edição), TODOS os
 *    efeitos com sobrevida vinculada terminam (a barreira quebrou).
 *  - Se um efeito com sobrevida vinculada terminar (duração, resistência ou
 *    remoção manual), a sobrevida que ele concedeu some (remove até o valor
 *    vinculado; nunca abaixo de 0).
 *
 * Implementado por hooks de atualização do ATOR — assim qualquer caminho de
 * remoção (expiração por rodada, rolagem de fim, botão da ficha, macro) é
 * coberto sem precisar alterar cada um deles.
 */

/**
 * Compara o array de efeitos aplicados antes/depois de uma atualização e
 * devolve a soma de sobrevida vinculada dos efeitos que SUMIRAM.
 * @returns {{gone:number, labels:string[]}}
 */
export function linkedTempRemoved(prevFx, curFx) {
  const curIds = new Set((curFx || []).map((e) => e?.fxId).filter(Boolean));
  let gone = 0;
  const labels = [];
  for (const e of prevFx || []) {
    const linked = Number(e?.tempHp) || 0;
    if (linked > 0 && e.fxId && !curIds.has(e.fxId)) {
      gone += linked;
      labels.push(e.label || "Efeito");
    }
  }
  return { gone, labels };
}

/**
 * Separa os efeitos aplicados em "mantidos" e "quebrados" (com sobrevida
 * vinculada > 0) — usado quando a sobrevida zera.
 * @returns {{keep:Array, broken:Array}}
 */
export function splitBrokenBarriers(fxArr) {
  const keep = [];
  const broken = [];
  for (const e of fxArr || []) {
    if ((Number(e?.tempHp) || 0) > 0) broken.push(e);
    else keep.push(e);
  }
  return { keep, broken };
}

/** Registra os hooks do ciclo de vida das barreiras. */
export function registerBarrierHooks() {
  // Guarda o estado ANTERIOR (efeitos + sobrevida) para comparação.
  Hooks.on("preUpdateActor", function (actor, changes, options) {
    const fxChanged = foundry.utils.hasProperty(changes, "system.appliedEffects");
    const tempChanged = foundry.utils.hasProperty(changes, "system.resources.hp.temp");
    if (!fxChanged && !tempChanged) return;
    options.ligeiaPrevFx = foundry.utils.deepClone(actor.system?.appliedEffects || []);
    options.ligeiaPrevTemp = actor.system?.resources?.hp?.temp || 0;
  });

  Hooks.on("updateActor", async function (actor, changes, options, userId) {
    if (game.user.id !== userId) return; // só quem fez a mudança processa
    if (options.ligeiaBarrierOp) return; // ajuste interno: não reprocessa
    if (options.ligeiaPrevFx === undefined) return;

    const curFx = actor.system?.appliedEffects || [];
    const curTemp = actor.system?.resources?.hp?.temp || 0;
    let temp = curTemp;

    // 1) Efeitos com sobrevida vinculada que SUMIRAM → a sobrevida some.
    if (foundry.utils.hasProperty(changes, "system.appliedEffects")) {
      const { gone, labels } = linkedTempRemoved(options.ligeiaPrevFx, curFx);
      if (gone > 0 && temp > 0) {
        temp = Math.max(0, temp - gone);
        await actor.update({ "system.resources.hp.temp": temp }, { ligeiaBarrierOp: true });
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="ligeia-roll-flavor"><strong>${actor.name}</strong>: a sobrevida vinculada de <em>${labels.join(", ")}</em> se dissipa (sobrevida: ${temp}).</div>`,
        });
      }
    }

    // 2) Sobrevida chegou a 0 → efeitos vinculados (barreiras) terminam.
    const zeroedNow = temp === 0 && ((options.ligeiaPrevTemp || 0) > 0 || curTemp !== temp);
    if (zeroedNow) {
      const { keep, broken } = splitBrokenBarriers(curFx);
      if (broken.length) {
        const upd = { "system.appliedEffects": keep };
        const clearConds = new Set(broken.map((e) => e.conditionId).filter(Boolean));
        if (clearConds.size) {
          upd["system.conditions"] = (actor.system?.conditions || []).filter((c) => !clearConds.has(c));
        }
        await actor.update(upd, { ligeiaBarrierOp: true });
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="ligeia-roll-flavor"><strong>${actor.name}</strong>: a sobrevida zerou — <em>${broken.map((e) => e.label || "Efeito").join(", ")}</em> ${broken.length > 1 ? "terminam" : "termina"}.</div>`,
        });
      }
    }
  });
}
