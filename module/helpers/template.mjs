/**
 * Templates de medição (área/aura) para ações do Ligeia.
 *
 * - Área: posicionamento INTERATIVO de um círculo (raio da ação) no canvas;
 *   o jogador move o mouse e clica para confirmar (clique direito cancela).
 * - Aura: círculo centrado automaticamente no token do personagem.
 *
 * Após posicionar, os tokens cujo centro está dentro do círculo são mirados
 * automaticamente (viram alvos de game.user), para a ação resolver sobre eles.
 *
 * Toda a interação com o canvas é embrulhada em try/catch pelo chamador, de
 * modo que, se a API divergir nesta build, a rolagem ainda acontece.
 */

function MTObjectClass() {
  return (
    foundry.canvas?.placeables?.MeasuredTemplate ||
    CONFIG.MeasuredTemplate?.objectClass
  );
}

/**
 * Mira automaticamente os tokens dentro de um círculo (centro em pixels,
 * raio em metros/unidades do grid).
 * @returns {number} quantos tokens foram mirados
 */
export function targetTokensInCircle(cx, cy, radiusUnits) {
  try {
    const grid = canvas.grid;
    const radiusPx = (radiusUnits / grid.distance) * grid.size;
    const inside = [];
    for (const tk of canvas.tokens.placeables) {
      const c = tk.center;
      if (Math.hypot(c.x - cx, c.y - cy) <= radiusPx) inside.push(tk);
    }
    // Mira visualmente (highlight) os tokens dentro do círculo. Usamos
    // Token#setTarget porque game.user.updateTokenTargets não existe em
    // todas as builds do V13.
    const insideSet = new Set(inside.map((t) => t.id));
    for (const tk of canvas.tokens.placeables) {
      const shouldTarget = insideSet.has(tk.id);
      const isTargeted = tk.targeted?.has?.(game.user);
      if (shouldTarget && !isTargeted) {
        tk.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
      } else if (!shouldTarget && isTargeted) {
        tk.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
      }
    }
    // Devolve os ATORES de dentro (fonte de verdade para resolver a ação,
    // evitando corrida com a atualização assíncrona de game.user.targets).
    return inside.map((t) => t.actor).filter(Boolean);
  } catch (e) {
    console.warn("Ligeia | falha ao mirar tokens na área:", e);
    return [];
  }
}

/** Cria os dados base de um template circular. */
function circleData(radius, x, y) {
  return {
    t: "circle",
    user: game.user.id,
    distance: radius,
    direction: 0,
    x: x ?? 0,
    y: y ?? 0,
    fillColor: game.user.color || "#ff0000",
    flags: { "ligeia-rpg": { transient: true } },
  };
}

/**
 * AURA: cria um círculo centrado no token do ator (sem posicionamento).
 * @returns {MeasuredTemplateDocument|null}
 */
export async function placeAuraTemplate(actor, radius) {
  const token = actor.getActiveTokens?.(true)?.[0] || actor.getActiveTokens?.()?.[0];
  if (!token) {
    ui.notifications?.warn("O personagem precisa de um token na cena para a aura.");
    return null;
  }
  const cls = CONFIG.MeasuredTemplate.documentClass;
  const data = circleData(radius, token.center.x, token.center.y);
  await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  // Mira e devolve os atores dentro da aura
  return targetTokensInCircle(token.center.x, token.center.y, radius);
}

/**
 * ÁREA: posicionamento interativo de um círculo. Resolve com o template
 * criado, ou null se cancelado.
 * @returns {Promise<MeasuredTemplateDocument|null>}
 */
export async function placeAreaTemplate(actor, radius) {
  const Base = MTObjectClass();
  if (!Base) return null;

  const cls = CONFIG.MeasuredTemplate.documentClass;
  // Começa perto do token do ator, se houver
  const token = actor.getActiveTokens?.(true)?.[0];
  const start = token ? { x: token.center.x, y: token.center.y } : { x: 0, y: 0 };
  const doc = new cls(circleData(radius, start.x, start.y), { parent: canvas.scene });
  const preview = new Base(doc);

  const initialLayer = canvas.activeLayer;
  await preview.draw();
  preview.layer.activate();
  preview.layer.preview.addChild(preview);

  return new Promise((resolve) => {
    let finished = false;
    let lastMove = 0;

    const getPoint = (event) => {
      // Compatibilidade entre versões de PIXI/Foundry
      if (typeof event.getLocalPosition === "function") {
        return event.getLocalPosition(preview.layer);
      }
      if (event.data?.getLocalPosition) {
        return event.data.getLocalPosition(preview.layer);
      }
      return { x: doc.x, y: doc.y };
    };

    const snap = (pt) => {
      try {
        const mode =
          CONST.GRID_SNAPPING_MODES?.CENTER ?? 0;
        return canvas.grid.getSnappedPoint
          ? canvas.grid.getSnappedPoint({ x: pt.x, y: pt.y }, { mode })
          : pt;
      } catch (e) {
        return pt;
      }
    };

    const onMove = (event) => {
      if (finished) return;
      event.stopPropagation?.();
      const now = Date.now();
      if (now - lastMove < 20) return;
      lastMove = now;
      const pt = snap(getPoint(event));
      doc.updateSource({ x: pt.x, y: pt.y });
      preview.refresh();
    };

    const cleanup = () => {
      finished = true;
      canvas.stage.off("mousemove", onMove);
      canvas.stage.off("mousedown", onConfirm);
      if (canvas.app?.view) canvas.app.view.oncontextmenu = null;
      try { preview.destroy(); } catch (e) {}
      initialLayer?.activate();
    };

    const onConfirm = async (event) => {
      if (finished) return;
      event.stopPropagation?.();
      const pt = snap(getPoint(event));
      const finalData = doc.toObject();
      finalData.x = pt.x;
      finalData.y = pt.y;
      cleanup();
      try {
        await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [finalData]);
        const actors = targetTokensInCircle(finalData.x, finalData.y, radius);
        resolve({ ok: true, actors });
      } catch (e) {
        console.warn("Ligeia | falha ao criar template de área:", e);
        resolve({ ok: true, actors: [] });
      }
    };

    const onCancel = (event) => {
      event.preventDefault?.();
      if (finished) return;
      cleanup();
      resolve({ ok: false, actors: [] }); // cancelado
    };

    canvas.stage.on("mousemove", onMove);
    canvas.stage.on("mousedown", onConfirm);
    if (canvas.app?.view) canvas.app.view.oncontextmenu = onCancel;
    ui.notifications?.info("Clique para posicionar a área (botão direito cancela).");
  });
}

/**
 * Ponto de entrada: posiciona o template apropriado para uma ação de
 * área/aura e devolve os atores afetados.
 *
 * @returns {Promise<{proceed: boolean, actors: Actor[]|null}>}
 *   proceed=false só quando o jogador cancela o posicionamento da área.
 *   actors=null quando o modo não é área/aura (use o targeting normal).
 */
export async function placeTemplateForAction(actor, action) {
  const mode = action.targetMode;
  const radius = Number(action.area) || 0;
  if (mode !== "area" && mode !== "aura") return { proceed: true, actors: null };
  if (radius <= 0) return { proceed: true, actors: null };
  if (!canvas?.scene) return { proceed: true, actors: null };

  try {
    if (mode === "aura") {
      const actors = await placeAuraTemplate(actor, radius);
      return { proceed: true, actors: actors || [] };
    } else {
      const res = await placeAreaTemplate(actor, radius);
      return { proceed: res.ok, actors: res.actors || [] };
    }
  } catch (e) {
    console.warn("Ligeia | erro ao posicionar template; seguindo sem ele:", e);
    return { proceed: true, actors: null };
  }
}
