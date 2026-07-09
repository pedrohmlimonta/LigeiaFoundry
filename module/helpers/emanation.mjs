/**
 * Emanação: áreas/auras PERSISTENTES que ficam no canvas por uma duração e
 * disparam a rolagem/efeito de uma ação para todo token que INICIAR o turno
 * dentro delas.
 *
 * - Uma "área" é fixa num ponto; uma "aura" segue o token de origem.
 * - Os metadados ficam na flag `ligeia-rpg.emanation` do MeasuredTemplate.
 * - O disparo acontece no início do turno de cada combatente (hook de
 *   atualização do combate). A duração é controlada por rodadas (ou até o
 *   fim da cena) e os templates expirados são removidos.
 *
 * Tudo é processado apenas pelo GM (um único cliente), para evitar execuções
 * duplicadas em mesa com vários jogadores.
 */

import { rollItemAction } from "./dice.mjs";

const FLAG_SCOPE = "ligeia-rpg";
const FLAG_KEY = "emanation";

/** Lê a flag de emanação de um template (ou null). */
function emanationOf(template) {
  return template?.flags?.[FLAG_SCOPE]?.[FLAG_KEY] || null;
}

/** Todos os templates de emanação da cena ativa. */
function emanationTemplates(scene) {
  const sc = scene || canvas?.scene;
  if (!sc) return [];
  // V14 removeu os Measured Templates: scene.templates pode não existir.
  const templates = sc.templates;
  if (!templates?.filter) return [];
  return templates.filter((t) => !!emanationOf(t));
}

/** Converte raio (unidades do grid) para pixels. */
function radiusToPx(radiusUnits) {
  const grid = canvas.grid;
  return (radiusUnits / grid.distance) * grid.size;
}

/** Um ponto (px) está dentro do círculo do template? */
function isPointInTemplate(px, py, template) {
  const r = radiusToPx(template.distance || 0);
  return Math.hypot(px - template.x, py - template.y) <= r + 0.5;
}

/**
 * Resolve a ação associada a uma emanação a partir das flags.
 * @returns {{actor, item, action}|null}
 */
async function resolveEmanationAction(ema) {
  let item = null;
  let action = null;
  let actor = null;
  try {
    if (ema.itemUuid) item = await fromUuid(ema.itemUuid);
    if (ema.actorUuid) actor = await fromUuid(ema.actorUuid);
  } catch (e) {
    item = null;
  }
  if (item) {
    const list = item.system?.actions || [];
    // Tenta pelo índice; se não bater, procura pelo label.
    action = list[ema.actionIndex] || list.find((a) => a.label === ema.actionLabel) || null;
    if (!actor) actor = item.parent || null;
  }
  if (!actor || !action) return null;
  return { actor, item, action };
}

/**
 * Dispara a rolagem/efeito de uma emanação contra UM ator-alvo (o que iniciou
 * o turno dentro da área). Reaproveita rollItemAction com override de alvo.
 */
async function triggerEmanationOn(ema, targetActor) {
  const resolved = await resolveEmanationAction(ema);
  if (!resolved) return;
  const { actor, item, action } = resolved;

  // Não reaplica os custos/macro da fonte a cada turno: clona a ação sem
  // custos e sem macro (a emanação é o efeito recorrente, não um novo conjuro).
  const turnAction = foundry.utils.deepClone(action);
  turnAction.costMp = 0; turnAction.costHp = 0; turnAction.costHeroic = 0;
  turnAction.macroUuid = ""; turnAction.macroEnabled = false;
  // A área já existe; ao disparar por turno NÃO recriamos template.
  turnAction.targetMode = "target";
  turnAction.persistArea = false;
  // Disparo automático: nunca abrir a caixa de rolagem.
  turnAction.skipRollDialog = true;
  // Movimentos INTERATIVOS (teleporte/telecinese) pediriam um clique a cada
  // turno — desligamos. Os direcionais (empurrar/puxar/lateral) continuam,
  // permitindo auras que arrastam quem está dentro.
  if (turnAction.movement?.enabled && ["teleport", "place"].includes(turnAction.movement.kind)) {
    turnAction.movement = { ...turnAction.movement, enabled: false };
  }

  // A rolagem de ataque: se a emanação marcar "refazer", rola de novo a cada
  // disparo (frozen = null). Senão, usa o total congelado na criação como CD.
  const frozen = ema.rerollAttack
    ? null
    : ((ema.attackTotal != null) ? Number(ema.attackTotal) : null);

  await rollItemAction({
    actor,
    item,
    action: turnAction,
    overrideTargets: [targetActor],
    hidden: actor.system?.rollHidden ?? false,
    frozenAttackTotal: frozen,
  });
}

/**
 * No início do turno de um combatente, verifica todas as emanações da cena e
 * dispara as que o contêm.
 */
async function handleTurnStart(combatant) {
  if (!combatant) return;
  const token = combatant.token?.object || canvas.tokens?.get(combatant.tokenId);
  const tokenDoc = combatant.token;
  const targetActor = combatant.actor;
  if (!targetActor || !tokenDoc) return;

  const cx = (tokenDoc.x ?? 0) + ((tokenDoc.width ?? 1) * canvas.grid.size) / 2;
  const cy = (tokenDoc.y ?? 0) + ((tokenDoc.height ?? 1) * canvas.grid.size) / 2;

  for (const template of emanationTemplates(combatant.parent?.scene)) {
    const ema = emanationOf(template);
    if (!ema) continue;
    // Só dispara no início do turno se o gatilho incluir "turn".
    const trig = ema.trigger || "both";
    if (trig !== "turn" && trig !== "both") continue;
    // A fonte só é afetada se a ação marcar persistAffectsSelf.
    if (!ema.affectsSelf && ema.actorUuid === targetActor.uuid) continue;
    if (!isPointInTemplate(cx, cy, template)) continue;
    await triggerEmanationOn(ema, targetActor);
  }
}

/**
 * Decrementa a duração das emanações ao virar a rodada e remove as expiradas.
 * Emanações com rounds=0 duram até o fim da cena (não expiram por rodada).
 */
async function handleRoundAdvance(combat) {
  const scene = combat?.scene || canvas?.scene;
  if (!scene) return;
  const toDelete = [];
  const updates = [];
  for (const template of emanationTemplates(scene)) {
    const ema = emanationOf(template);
    if (!ema || !ema.rounds) continue; // 0 = até fim da cena
    const remaining = (ema.remaining ?? ema.rounds) - 1;
    if (remaining <= 0) {
      toDelete.push(template.id);
    } else {
      updates.push({ _id: template.id, [`flags.${FLAG_SCOPE}.${FLAG_KEY}.remaining`]: remaining });
    }
  }
  if (updates.length) await scene.updateEmbeddedDocuments("MeasuredTemplate", updates);
  if (toDelete.length) {
    await scene.deleteEmbeddedDocuments("MeasuredTemplate", toDelete);
    ui.notifications?.info(`${toDelete.length} emanação(ões) expiraram.`);
  }
}

/**
 * Move as auras (emanações que seguem o token) quando o token de origem se
 * move. Áreas fixas não se movem.
 *
 * IMPORTANTE: a posição é lida do parâmetro `dest` (vinda do objeto `changed`
 * do hook), porque nesta build, ao disparar `updateToken`, `tokenDoc.x/y`
 * ainda podem refletir a posição de PARTIDA — o que fazia a aura seguir o
 * ponto de onde o token saiu, em vez de onde parou.
 */
async function handleTokenMove(tokenDoc, dest) {
  const scene = tokenDoc.parent;
  if (!scene) return;
  const gridSize = scene.grid?.size || canvas.grid?.size || 100;
  const x = dest?.x ?? tokenDoc.x ?? 0;
  const y = dest?.y ?? tokenDoc.y ?? 0;
  const updates = [];
  for (const template of emanationTemplates(scene)) {
    const ema = emanationOf(template);
    if (!ema?.isAura) continue;
    if (ema.sourceTokenId !== tokenDoc.id) continue;
    const cx = x + ((tokenDoc.width ?? 1) * gridSize) / 2;
    const cy = y + ((tokenDoc.height ?? 1) * gridSize) / 2;
    updates.push({ _id: template.id, x: cx, y: cy });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("MeasuredTemplate", updates);
}

/**
 * Dispara as emanações em que o token ENTROU com este movimento (centro antes
 * estava FORA e agora está DENTRO). Usa o gatilho "enter"/"both".
 * @param {TokenDocument} tokenDoc
 * @param {{x:number,y:number}} oldCenter  centro antes do movimento
 * @param {{x:number,y:number}} newCenter  centro após o movimento
 */
async function handleTokenEnter(tokenDoc, oldCenter, newCenter) {
  const scene = tokenDoc.parent;
  if (!scene || !oldCenter || !newCenter) return;
  const targetActor = tokenDoc.actor;
  if (!targetActor) return;

  for (const template of emanationTemplates(scene)) {
    const ema = emanationOf(template);
    if (!ema) continue;
    const trig = ema.trigger || "both";
    if (trig !== "enter" && trig !== "both") continue;
    // A fonte só é afetada se marcar persistAffectsSelf.
    if (!ema.affectsSelf && ema.actorUuid === targetActor.uuid) continue;
    const wasInside = isPointInTemplate(oldCenter.x, oldCenter.y, template);
    const nowInside = isPointInTemplate(newCenter.x, newCenter.y, template);
    // Só dispara na TRANSIÇÃO de fora → dentro (não a cada passo dentro).
    if (!wasInside && nowInside) {
      await triggerEmanationOn(ema, targetActor);
    }
  }
}

/** Centro (px) de um token a partir de uma posição (x,y) de canto. */
function centerFromPos(tokenDoc, x, y, gridSize) {
  const gs = gridSize || tokenDoc.parent?.grid?.size || canvas.grid?.size || 100;
  return {
    x: (x ?? 0) + ((tokenDoc.width ?? 1) * gs) / 2,
    y: (y ?? 0) + ((tokenDoc.height ?? 1) * gs) / 2,
  };
}

/* ------------------------------------------------------------------ */
/*  Registro dos hooks                                                 */
/* ------------------------------------------------------------------ */

/** Detecta se ESTE cliente deve processar (apenas um GM ativo). */
function isResponsibleClient() {
  // O GM com menor id entre os ativos processa (evita duplicação).
  const activeGMs = game.users.filter((u) => u.isGM && u.active);
  if (!activeGMs.length) return game.user.isGM; // fallback
  const responsible = activeGMs.sort((a, b) => a.id.localeCompare(b.id))[0];
  return responsible?.id === game.user.id;
}

export function registerEmanationHooks() {
  // Início de turno: o Foundry dispara updateCombat com mudança de turn/round.
  Hooks.on("updateCombat", async (combat, changed, options, userId) => {
    if (!isResponsibleClient()) return;
    // Avanço de rodada (para expiração de duração).
    if (Object.prototype.hasOwnProperty.call(changed, "round")) {
      await handleRoundAdvance(combat);
    }
    // Mudança de turno (ou de rodada, que também muda o combatente ativo):
    const turnChanged =
      Object.prototype.hasOwnProperty.call(changed, "turn") ||
      Object.prototype.hasOwnProperty.call(changed, "round");
    if (turnChanged) {
      const current = combat.combatant;
      await handleTurnStart(current);
    }
  });

  // Captura o centro ANTIGO do token antes do movimento (para detectar
  // entrada na área). O objeto `options` é o mesmo no pre e no update.
  Hooks.on("preUpdateToken", (tokenDoc, changed, options, userId) => {
    if (!("x" in changed) && !("y" in changed)) return;
    options.ligeiaOldCenter = centerFromPos(tokenDoc, tokenDoc.x, tokenDoc.y);
  });

  // No movimento do token: (1) move as auras que pertencem a ele e (2)
  // dispara emanações em que ele ENTROU. Lê o destino de `changed` (e não de
  // tokenDoc.x/y, que pode estar na posição de partida no momento do hook).
  Hooks.on("updateToken", async (tokenDoc, changed, options, userId) => {
    if (!isResponsibleClient()) return;
    if (!("x" in changed) && !("y" in changed)) return;

    const gs = tokenDoc.parent?.grid?.size || canvas.grid?.size || 100;
    const newX = changed.x ?? tokenDoc.x;
    const newY = changed.y ?? tokenDoc.y;
    const dest = { x: newX, y: newY };
    const newCenter = centerFromPos(tokenDoc, newX, newY, gs);
    const oldCenter = options.ligeiaOldCenter || centerFromPos(tokenDoc, tokenDoc.x, tokenDoc.y, gs);

    // (1) Mover auras que seguem este token (espera a animação terminar).
    const followsThis = emanationTemplates(tokenDoc.parent).some(
      (t) => emanationOf(t)?.isAura && emanationOf(t)?.sourceTokenId === tokenDoc.id
    );
    if (followsThis) {
      try {
        const obj = tokenDoc.object;
        if (obj && options?.animate !== false && typeof CanvasAnimation !== "undefined") {
          const name = obj.animationName || `Token.${tokenDoc.id}.animate`;
          const anim = CanvasAnimation.getAnimation?.(name);
          if (anim?.promise) await anim.promise;
        }
      } catch (e) { /* sem animação disponível; segue */ }
      await handleTokenMove(tokenDoc, dest);
    }

    // (2) Detectar ENTRADA em qualquer emanação (gatilho enter/both).
    await handleTokenEnter(tokenDoc, oldCenter, newCenter);
  });

  // Limpeza: ao encerrar o combate, remove as emanações de duração por rodada.
  Hooks.on("deleteCombat", async (combat) => {
    if (!isResponsibleClient()) return;
    const scene = combat?.scene || canvas?.scene;
    if (!scene) return;
    const ids = emanationTemplates(scene)
      .filter((t) => (emanationOf(t)?.rounds || 0) > 0)
      .map((t) => t.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("MeasuredTemplate", ids);
  });
}
