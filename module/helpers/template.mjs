/**
 * Templates de medição (área/aura) para ações do Ligeia.
 *
 * - Área: posicionamento INTERATIVO de um círculo (raio da ação) no canvas;
 *   o jogador move o mouse e clica para confirmar (clique direito cancela).
 * - Aura: círculo centrado automaticamente no token do personagem.
 *
 * Após posicionar, os tokens cujo centro está dentro do círculo são mirados
 * automaticamente (viram alvos de game.user), para a ação resolver sobre eles.
 * O filtro de alvos da ação (só aliados/só inimigos — incluindo o override
 * por efeito e a checkbox "Inimigo" dos NPCs) é aplicado JÁ NA MIRA VISUAL,
 * para os marcadores no mapa espelharem exatamente quem será afetado.
 *
 * Toda a interação com o canvas é embrulhada em try/catch pelo chamador, de
 * modo que, se a API divergir nesta build, a rolagem ainda acontece.
 *
 * COMPATIBILIDADE V14: o V14 removeu os Measured Templates. Quando eles não
 * estão disponíveis, degradamos com elegância — a ação ainda afeta os alvos
 * (aura: quem está no raio ao redor do lançador; área: os alvos mirados),
 * apenas sem o círculo visual (que dependerá de uma reescrita para Regions).
 */

import { measuredTemplatesAvailable } from "./compat.mjs";
import { passesAreaFilter } from "./dice.mjs";
import { areaFilterOverrideFor } from "./effects.mjs";

function MTObjectClass() {
  return (
    foundry.canvas?.placeables?.MeasuredTemplate ||
    CONFIG.MeasuredTemplate?.objectClass
  );
}

/**
 * Mira automaticamente os tokens dentro de um círculo (centro em pixels,
 * raio em metros/unidades do grid). Se `filterFn(actor)` for fornecido,
 * apenas os tokens que passam no filtro são mirados (e devolvidos).
 * @returns {Actor[]} os atores dos tokens mirados
 */
export function targetTokensInCircle(cx, cy, radiusUnits, filterFn = null) {
  try {
    const grid = canvas.grid;
    const radiusPx = (radiusUnits / grid.distance) * grid.size;
    let inside = [];
    for (const tk of canvas.tokens.placeables) {
      const c = tk.center;
      if (Math.hypot(c.x - cx, c.y - cy) <= radiusPx) inside.push(tk);
    }
    // Filtro de alvos (só aliados/só inimigos): aplicado ANTES da mira
    // visual, para que os marcadores no mapa espelhem exatamente quem a
    // ação vai afetar. NPCs contam como inimigos/aliados pela checkbox
    // "Inimigo" da ficha (via passesAreaFilter, no chamador).
    if (typeof filterFn === "function") {
      inside = inside.filter((tk) => tk.actor && filterFn(tk.actor));
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

/** Cria os dados base de um template circular.
 *  Se `persistFlags` for fornecido, a área é PERSISTENTE (emanação): não é
 *  transitória e carrega os metadados para refazer a rolagem por turno.
 */
function circleData(radius, x, y, persistFlags = null) {
  const lig = persistFlags
    ? { transient: false, emanation: persistFlags }
    : { transient: true };
  return {
    t: "circle",
    user: game.user.id,
    distance: radius,
    direction: 0,
    x: x ?? 0,
    y: y ?? 0,
    fillColor: game.user.color || "#ff0000",
    flags: { "ligeia-rpg": lig },
  };
}

/**
 * Monta os metadados de emanação gravados na flag do template, usados para
 * refazer a rolagem da ação a cada início de turno de quem está dentro.
 */
function buildEmanationFlags(actor, item, action) {
  const token = actor.getActiveTokens?.(true)?.[0] || actor.getActiveTokens?.()?.[0];
  return {
    actorUuid: actor.uuid,
    itemUuid: item?.uuid || null,
    actionLabel: action.label || "",
    // Índice da ação dentro do item (para reencontrá-la na execução por turno).
    actionIndex: (item?.system?.actions || []).indexOf(action),
    isAura: action.targetMode === "aura",
    sourceTokenId: token?.id || null,
    affectsSelf: !!action.persistAffectsSelf,
    // Se true, refaz a rolagem de ataque a cada disparo (não congela).
    rerollAttack: !!action.persistRerollAttack,
    // Gatilho: "turn" (início do turno dentro), "enter" (ao entrar) ou "both".
    trigger: action.persistTrigger || "both",
    radius: Number(action.area) || 0,
    // Total do ataque rolado na CRIAÇÃO (congelado). Preenchido logo após a
    // primeira rolagem; usado como CD das defesas por turno. null = ainda não
    // rolado (ou ação sem ataque).
    attackTotal: null,
    // Duração: rounds>0 = N rodadas; 0 = até o fim da cena.
    rounds: Number(action.persistRounds) || 0,
    // Rodada do combate em que foi criada (para expiração).
    createdRound: game.combat?.round ?? null,
    remaining: Number(action.persistRounds) || 0,
  };
}

/**
 * AURA: cria um círculo centrado no token do ator (sem posicionamento).
 * @returns {MeasuredTemplateDocument|null}
 */
export async function placeAuraTemplate(actor, radius, persistFlags = null, filterFn = null) {
  const token = actor.getActiveTokens?.(true)?.[0] || actor.getActiveTokens?.()?.[0];
  if (!token) {
    ui.notifications?.warn("O personagem precisa de um token na cena para a aura.");
    return null;
  }
  const data = circleData(radius, token.center.x, token.center.y, persistFlags);
  let created = null;
  try {
    created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  } catch (e) {
    // No V14 os MeasuredTemplates são um shim sobre Regions e a criação pode
    // falhar/avisar. Mesmo sem o círculo visual, a aura é resolvida.
    console.warn("Ligeia | falha ao criar template de aura (seguindo sem o círculo):", e);
  }
  // Mira e devolve os atores dentro da aura (já passando pelo filtro)
  const actors = targetTokensInCircle(token.center.x, token.center.y, radius, filterFn);
  return { actors, templateId: created?.[0]?.id || null };
}

/**
 * ÁREA: posicionamento interativo de um círculo. Resolve com o template
 * criado, ou null se cancelado.
 * @returns {Promise<MeasuredTemplateDocument|null>}
 */
export async function placeAreaTemplate(actor, radius, persistFlags = null, filterFn = null) {
  const Base = MTObjectClass();
  if (!Base) return null;

  const cls = CONFIG.MeasuredTemplate.documentClass;
  // Começa perto do token do ator, se houver
  const token = actor.getActiveTokens?.(true)?.[0];
  const start = token ? { x: token.center.x, y: token.center.y } : { x: 0, y: 0 };
  const doc = new cls(circleData(radius, start.x, start.y, persistFlags), { parent: canvas.scene });
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
        const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [finalData]);
        const actors = targetTokensInCircle(finalData.x, finalData.y, radius, filterFn);
        resolve({ ok: true, actors, templateId: created?.[0]?.id || null });
      } catch (e) {
        // No V14 os MeasuredTemplates são um shim sobre Regions e a criação
        // pode falhar/avisar. Mesmo sem o círculo visual, a área é resolvida
        // nos tokens do local escolhido.
        console.warn("Ligeia | falha ao criar template de área (seguindo sem o círculo):", e);
        const actors = targetTokensInCircle(finalData.x, finalData.y, radius, filterFn);
        resolve({ ok: true, actors, templateId: null });
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
export async function placeTemplateForAction(actor, item, action) {
  const mode = action.targetMode;
  const radius = Number(action.area) || 0;
  if (mode !== "area" && mode !== "aura") return { proceed: true, actors: null };
  if (radius <= 0) return { proceed: true, actors: null };
  if (!canvas?.scene) return { proceed: true, actors: null };

  // Filtro de alvos EFETIVO (todos/só aliados/só inimigos): um efeito ativo
  // do tipo "Filtro de área" no conjurador sobrepõe o filtro configurado na
  // ação. Aliado/inimigo é decidido por passesAreaFilter — para NPCs, pela
  // checkbox "Inimigo" da ficha (marcada = inimigo; desmarcada = aliado).
  const effFilter = areaFilterOverrideFor(actor) || action.areaFilter || "all";
  const filterFn = effFilter === "all" ? null : (tActor) => passesAreaFilter(actor, tActor, effFilter);

  // --- Compatibilidade V14: sem Measured Templates ---
  // Não há como desenhar o círculo (o documento foi removido). Degradamos:
  //  - aura: mira quem está no raio ao redor do token do lançador;
  //  - área: usa os alvos atualmente mirados (o jogador seleciona os alvos).
  if (!measuredTemplatesAvailable()) {
    if (action.persistArea) {
      ui.notifications?.warn("Emanação persistente (área/aura contínua) ainda não é suportada no Foundry V14 — os templates visuais serão reescritos para Regions. A ação será resolvida uma vez.");
    }
    if (mode === "aura") {
      const token = actor.getActiveTokens?.(true)?.[0] || actor.getActiveTokens?.()?.[0];
      if (token?.center) {
        const actors = targetTokensInCircle(token.center.x, token.center.y, radius, filterFn);
        ui.notifications?.info(`Aura de ${radius}m resolvida ao redor de ${actor.name} (sem círculo visual no V14).`);
        return { proceed: true, actors, templateId: null };
      }
      return { proceed: true, actors: [], templateId: null };
    }
    // área: usa os alvos mirados (aplicando o filtro de alvos)
    let targeted = Array.from(game.user?.targets ?? []).map((t) => t.actor).filter(Boolean);
    if (filterFn) targeted = targeted.filter(filterFn);
    ui.notifications?.info(`Área de ${radius}m: usando os alvos mirados (sem círculo visual no V14). Mire os alvos atingidos.`);
    return { proceed: true, actors: targeted, templateId: null };
  }

  // Se a ação cria emanação persistente, monta os metadados para gravar na
  // flag do template (usados para refazer a rolagem por turno).
  const persistFlags = action.persistArea ? buildEmanationFlags(actor, item, action) : null;

  try {
    if (mode === "aura") {
      const res = await placeAuraTemplate(actor, radius, persistFlags, filterFn);
      return { proceed: true, actors: (res?.actors) || [], templateId: res?.templateId || null };
    } else {
      const res = await placeAreaTemplate(actor, radius, persistFlags, filterFn);
      return { proceed: res.ok, actors: res.actors || [], templateId: res?.templateId || null };
    }
  } catch (e) {
    console.warn("Ligeia | erro ao posicionar template; seguindo sem ele:", e);
    return { proceed: true, actors: null, templateId: null };
  }
}
