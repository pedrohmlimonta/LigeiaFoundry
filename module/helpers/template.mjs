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
import { areaFilterOverrideFor, resolveEffectValue } from "./effects.mjs";

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
function circleData(radius, x, y, persistFlags = null, followTokenId = null) {
  const lig = persistFlags
    ? { transient: false, emanation: persistFlags }
    : { transient: true };
  // AURA: guarda o token de origem para que a área ACOMPANHE o token quando
  // ele se mover (vale tanto para auras simples quanto para emanações).
  if (followTokenId) lig.follow = followTokenId;
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
 * Remove a área TEMPORÁRIA (não-emanação) alguns segundos após a ação, para
 * o círculo não ficar marcado no mapa (e, no caso das auras, não seguir o
 * token para sempre). Emanações contínuas são preservadas — elas têm o
 * próprio ciclo de vida (duração em rodadas / fim de cena).
 * @param {string} templateId
 * @param {Scene} [scene]
 * @param {number} [delayMs] tempo que a área fica visível após resolver
 */
export function scheduleTransientCleanup(templateId, scene = null, delayMs = 3000) {
  if (!templateId) return;
  const sc = scene || canvas?.scene;
  if (!sc) return;
  setTimeout(async () => {
    try {
      const tpl = sc.templates?.get?.(templateId);
      if (!tpl) return;
      const lig = tpl.getFlag?.("ligeia-rpg") ?? tpl.flags?.["ligeia-rpg"];
      if (lig?.transient === false || lig?.emanation) return; // emanação: mantém
      await sc.deleteEmbeddedDocuments("MeasuredTemplate", [templateId]);
    } catch (e) {
      console.warn("Ligeia | falha ao remover a área temporária:", e);
    }
  }, Math.max(0, delayMs));
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
    radius: resolveEffectValue(action.area, actor),
    // Total do ataque rolado na CRIAÇÃO (congelado). Preenchido logo após a
    // primeira rolagem; usado como CD das defesas por turno. null = ainda não
    // rolado (ou ação sem ataque).
    attackTotal: null,
    // Duração: rounds>0 = N rodadas; 0 = até o fim da cena.
    rounds: resolveEffectValue(action.persistRounds, actor),
    // Rodada do combate em que foi criada (para expiração).
    createdRound: game.combat?.round ?? null,
    remaining: resolveEffectValue(action.persistRounds, actor),
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
  // A aura nasce centrada no token e passa a segui-lo (flag "follow").
  const data = circleData(radius, token.center.x, token.center.y, persistFlags, token.id);
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
export async function placeAreaTemplate(actor, radius, persistFlags = null, filterFn = null, maxRange = 0) {
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

  // Cor original da borda (o feedback de alcance restaura ao voltar).
  const origBorder = doc.borderColor || "#ffffff";

  return new Promise((resolve) => {
    let finished = false;
    let lastMove = 0;
    let lastInRange = true;

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

    // Distância (em metros do grid) do centro do token do conjurador até um
    // ponto do canvas — mesma conversão usada pela mira da área.
    const distFromCaster = (pt) => {
      const grid = canvas.grid;
      return Math.hypot(pt.x - token.center.x, pt.y - token.center.y) / grid.size * grid.distance;
    };

    const onMove = (event) => {
      if (finished) return;
      event.stopPropagation?.();
      const now = Date.now();
      if (now - lastMove < 20) return;
      lastMove = now;
      const pt = snap(getPoint(event));
      doc.updateSource({ x: pt.x, y: pt.y });
      // Feedback de ALCANCE: borda vermelha quando o centro passa do limite.
      if (maxRange > 0 && token?.center) {
        try {
          const inRange = distFromCaster(pt) <= maxRange + 0.001;
          if (inRange !== lastInRange) {
            lastInRange = inRange;
            doc.updateSource({ borderColor: inRange ? origBorder : "#ff4444" });
          }
        } catch (e) { /* cosmético — ignora */ }
      }
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
      // ---- Checagem de ALCANCE do centro da área ----
      // O centro precisa estar a até maxRange metros do token do conjurador
      // (0 = ilimitado). Fora disso, a ação NÃO acontece — mesma regra do
      // alvo mirado fora de alcance.
      if (maxRange > 0 && token?.center) {
        const distM = distFromCaster(pt);
        if (distM > maxRange + 0.001) {
          cleanup();
          ui.notifications?.warn(
            `Fora de alcance: o centro da área está a ${distM.toFixed(1)}m — alcance máximo ${maxRange}m. A ação não foi executada.`,
          );
          resolve({ ok: false, actors: [] });
          return;
        }
      }
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
    ui.notifications?.info(
      maxRange > 0
        ? `Clique para posicionar a área — alcance máximo ${maxRange}m (botão direito cancela).`
        : "Clique para posicionar a área (botão direito cancela).",
    );
  });
}


/* ==================================================================== */
/*  FORMAS DIRECIONAIS: LINHA (ray) e CONE                              */
/*  Linha e cone partem do token de quem age; a mira define a direção.  */
/*  A "linha personalizada" é posicionada livremente (origem e rotação).*/
/* ==================================================================== */

/** Converte metros do grid para pixels. */
function toPx(units) {
  const grid = canvas.grid;
  return (Number(units) || 0) / grid.distance * grid.size;
}

/** Dados de um template de LINHA (ray). Comprimento/largura em metros. */
function rayData(length, width, x, y, direction, persistFlags = null, followTokenId = null) {
  const lig = persistFlags ? { transient: false, emanation: persistFlags } : { transient: true };
  if (followTokenId) lig.follow = followTokenId;
  return {
    t: "ray",
    user: game.user.id,
    x, y,
    direction: Number(direction) || 0,
    distance: Number(length) || 0,
    width: Number(width) || 0,
    fillColor: game.user.color?.css ?? game.user.color ?? "#ff9900",
    flags: { "ligeia-rpg": lig },
  };
}

/** Dados de um template de CONE. Comprimento em metros, ângulo em graus. */
function coneData(length, angle, x, y, direction, persistFlags = null, followTokenId = null) {
  const lig = persistFlags ? { transient: false, emanation: persistFlags } : { transient: true };
  if (followTokenId) lig.follow = followTokenId;
  return {
    t: "cone",
    user: game.user.id,
    x, y,
    direction: Number(direction) || 0,
    distance: Number(length) || 0,
    angle: Number(angle) || 45,
    fillColor: game.user.color?.css ?? game.user.color ?? "#ff9900",
    flags: { "ligeia-rpg": lig },
  };
}

/**
 * Mira os tokens dentro de uma LINHA: retângulo de comprimento x largura que
 * começa na origem e segue a direção informada.
 * @returns {Actor[]} atores mirados
 */
export function targetTokensInRay(ox, oy, directionDeg, length, width, filterFn = null) {
  const lenPx = toPx(length);
  const widPx = toPx(width);
  const rad = (Number(directionDeg) || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return targetTokensWhere((c) => {
    const dx = c.x - ox;
    const dy = c.y - oy;
    const ao_longo = dx * cos + dy * sin;         // projeção na direção
    if (ao_longo < 0 || ao_longo > lenPx) return false;
    const lateral = -dx * sin + dy * cos;         // distância perpendicular
    return Math.abs(lateral) <= widPx / 2;
  }, filterFn);
}

/**
 * Mira os tokens dentro de um CONE: setor circular de raio "length" e
 * abertura "angle" (graus), centrado na direção informada.
 * @returns {Actor[]} atores mirados
 */
export function targetTokensInCone(ox, oy, directionDeg, length, angleDeg, filterFn = null) {
  const lenPx = toPx(length);
  const rad = (Number(directionDeg) || 0) * Math.PI / 180;
  const meia = ((Number(angleDeg) || 45) * Math.PI / 180) / 2;
  return targetTokensWhere((c) => {
    const dx = c.x - ox;
    const dy = c.y - oy;
    const dist = Math.hypot(dx, dy);
    if (dist > lenPx) return false;
    if (dist === 0) return true; // exatamente na origem
    let delta = Math.atan2(dy, dx) - rad;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    return Math.abs(delta) <= meia;
  }, filterFn);
}

/**
 * Base comum: mira os tokens cujo centro satisfaz o teste geométrico e que
 * passam pelo filtro de alvos (só aliados / só inimigos).
 */
function targetTokensWhere(dentro, filterFn = null) {
  try {
    let alvos = canvas.tokens.placeables.filter((tk) => dentro(tk.center));
    if (typeof filterFn === "function") alvos = alvos.filter((tk) => tk.actor && filterFn(tk.actor));
    const ids = new Set(alvos.map((tk) => tk.id));
    for (const tk of canvas.tokens.placeables) {
      const querido = ids.has(tk.id);
      if (tk.targeted?.has?.(game.user) !== querido) tk.setTarget(querido, { user: game.user, releaseOthers: false, groupSelection: true });
    }
    return alvos.map((tk) => tk.actor).filter(Boolean);
  } catch (e) {
    console.warn("Ligeia | falha ao mirar tokens da forma:", e);
    return [];
  }
}

/**
 * Posiciona LINHA, CONE ou LINHA PERSONALIZADA e devolve os atores atingidos.
 *
 * spec = {
 *   kind: "ray" | "cone",
 *   length,            // comprimento em metros
 *   width,             // largura da linha (só ray)
 *   angle,             // abertura do cone em graus (só cone)
 *   rotation,          // direção inicial em graus
 *   freeOrigin,        // true = a origem é escolhida no mapa (linha custom)
 * }
 *
 * Da origem: a mira define a DIREÇÃO e o clique confirma.
 * Origem livre: o 1º clique fixa a origem, a mira gira a forma e o 2º clique
 * confirma (o botão direito cancela em qualquer fase).
 */
export async function placeShapeTemplate(actor, spec, persistFlags = null, filterFn = null, maxRange = 0) {
  const Base = MTObjectClass();
  if (!Base) return { ok: true, actors: [], templateId: null };
  const cls = CONFIG.MeasuredTemplate?.documentClass;
  if (!cls) return { ok: true, actors: [], templateId: null };

  const token = actor.getActiveTokens?.(true)?.[0] || actor.getActiveTokens?.()?.[0];
  const centro = token?.center || { x: 0, y: 0 };
  const seguir = spec.freeOrigin ? null : token?.id;

  let origem = { x: centro.x, y: centro.y };
  let direcao = Number(spec.rotation) || 0;

  const montaDados = () => (spec.kind === "cone"
    ? coneData(spec.length, spec.angle, origem.x, origem.y, direcao, persistFlags, seguir)
    : rayData(spec.length, spec.width, origem.x, origem.y, direcao, persistFlags, seguir));

  const doc = new cls(montaDados(), { parent: canvas.scene });
  const preview = new Base(doc);
  const initialLayer = canvas.activeLayer;
  await preview.draw();
  preview.layer.activate();
  preview.layer.preview.addChild(preview);

  const nomeForma = spec.kind === "cone" ? "cone" : "linha";

  return new Promise((resolve) => {
    let finished = false;
    let lastMove = 0;
    // Origem livre começa na fase 1 (posicionar); as demais já giram.
    let fase = spec.freeOrigin ? "posicao" : "direcao";

    const getPoint = (event) => {
      if (typeof event.getLocalPosition === "function") return event.getLocalPosition(preview.layer);
      if (event.data?.getLocalPosition) return event.data.getLocalPosition(preview.layer);
      return { x: origem.x, y: origem.y };
    };

    const snap = (pt) => {
      try {
        const m = CONST.GRID_SNAPPING_MODES?.CENTER ?? 0;
        return canvas.grid.getSnappedPoint ? canvas.grid.getSnappedPoint({ x: pt.x, y: pt.y }, { mode: m }) : pt;
      } catch (e) { return pt; }
    };

    const distDoConjurador = (pt) =>
      Math.hypot(pt.x - centro.x, pt.y - centro.y) / canvas.grid.size * canvas.grid.distance;

    const onMove = (event) => {
      if (finished) return;
      event.stopPropagation?.();
      const agora = Date.now();
      if (agora - lastMove < 20) return;
      lastMove = agora;
      const pt = getPoint(event);
      if (fase === "posicao") {
        origem = snap(pt);
        doc.updateSource({ x: origem.x, y: origem.y });
      } else {
        const dx = pt.x - origem.x;
        const dy = pt.y - origem.y;
        if (dx || dy) {
          direcao = Math.atan2(dy, dx) * 180 / Math.PI;
          doc.updateSource({ direction: direcao });
        }
      }
      preview.refresh();
    };

    const cleanup = () => {
      finished = true;
      canvas.stage.off("mousemove", onMove);
      canvas.stage.off("mousedown", onClick);
      if (canvas.app?.view) canvas.app.view.oncontextmenu = null;
      try { preview.destroy(); } catch (e) {}
      initialLayer?.activate();
    };

    const mirar = (dados) => (spec.kind === "cone"
      ? targetTokensInCone(dados.x, dados.y, dados.direction, spec.length, spec.angle, filterFn)
      : targetTokensInRay(dados.x, dados.y, dados.direction, spec.length, spec.width, filterFn));

    const onClick = async (event) => {
      if (finished) return;
      event.stopPropagation?.();

      // Fase 1 (linha personalizada): fixa a origem e passa a girar.
      if (fase === "posicao") {
        const pt = snap(getPoint(event));
        if (maxRange > 0 && token?.center) {
          const d = distDoConjurador(pt);
          if (d > maxRange + 0.001) {
            cleanup();
            ui.notifications?.warn(`Fora de alcance: a origem está a ${d.toFixed(1)}m — alcance máximo ${maxRange}m. A ação não foi executada.`);
            resolve({ ok: false, actors: [] });
            return;
          }
        }
        origem = pt;
        doc.updateSource({ x: origem.x, y: origem.y });
        preview.refresh();
        fase = "direcao";
        ui.notifications?.info("Agora gire a linha e clique para confirmar (botão direito cancela).");
        return;
      }

      // Fase final: confirma a forma.
      const finalData = doc.toObject();
      finalData.x = origem.x;
      finalData.y = origem.y;
      finalData.direction = direcao;
      cleanup();
      let templateId = null;
      try {
        const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [finalData]);
        templateId = created?.[0]?.id || null;
      } catch (e) {
        console.warn(`Ligeia | falha ao criar template de ${nomeForma} (seguindo sem o desenho):`, e);
      }
      resolve({ ok: true, actors: mirar(finalData), templateId });
    };

    const onCancel = (event) => {
      event.preventDefault?.();
      if (finished) return;
      cleanup();
      resolve({ ok: false, actors: [] });
    };

    canvas.stage.on("mousemove", onMove);
    canvas.stage.on("mousedown", onClick);
    if (canvas.app?.view) canvas.app.view.oncontextmenu = onCancel;
    ui.notifications?.info(
      fase === "posicao"
        ? "Clique para posicionar a origem da linha (botão direito cancela)."
        : `Mire a direção do ${nomeForma} e clique para confirmar (botão direito cancela).`,
    );
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
  const radius = resolveEffectValue(action.area, actor);
  const formas = ["line", "cone", "lineCustom"];
  if (mode !== "area" && mode !== "aura" && !formas.includes(mode)) return { proceed: true, actors: null };
  // Linha/cone usam o ALCANCE como comprimento; a linha personalizada usa a
  // "área" como comprimento.
  const comprimento = (mode === "line" || mode === "cone")
    ? resolveEffectValue(action.range, actor)
    : radius;
  if (formas.includes(mode) ? comprimento <= 0 : radius <= 0) return { proceed: true, actors: null };
  if (!canvas?.scene) return { proceed: true, actors: null };

  // Filtro de alvos EFETIVO (todos/só aliados/só inimigos): um efeito ativo
  // do tipo "Filtro de área" no conjurador sobrepõe o filtro configurado na
  // ação. Aliado/inimigo é decidido por passesAreaFilter — para NPCs, pela
  // checkbox "Inimigo" da ficha (marcada = inimigo; desmarcada = aliado).
  const effFilter = areaFilterOverrideFor(actor) || action.areaFilter || "all";
  const filterFn = effFilter === "all" ? null : (tActor) => passesAreaFilter(actor, tActor, effFilter);

  // Alcance da ação (fórmula resolvida com o conjurador): em ÁREA, limita a
  // distância máxima do CENTRO do círculo até o token (0 = ilimitado).
  const maxRange = resolveEffectValue(action.range, actor);

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
    // linha/cone/área: usa os alvos mirados (aplicando o filtro de alvos)
    let targeted = Array.from(game.user?.targets ?? []).map((t) => t.actor).filter(Boolean);
    if (filterFn) targeted = targeted.filter(filterFn);
    ui.notifications?.info(`Área de ${radius}m: usando os alvos mirados (sem círculo visual no V14). Mire os alvos atingidos.`);
    return { proceed: true, actors: targeted, templateId: null };
  }

  // Se a ação cria emanação persistente, monta os metadados para gravar na
  // flag do template (usados para refazer a rolagem por turno).
  const persistFlags = action.persistArea ? buildEmanationFlags(actor, item, action) : null;

  try {
    if (formas.includes(mode)) {
      const spec = {
        kind: mode === "cone" ? "cone" : "ray",
        length: comprimento,
        width: resolveEffectValue(action.lineWidth, actor) || 1.5,
        angle: resolveEffectValue(action.coneAngle, actor) || 45,
        rotation: resolveEffectValue(action.lineRotation, actor) || 0,
        freeOrigin: mode === "lineCustom",
      };
      // Só a linha personalizada tem a origem limitada pelo alcance; linha e
      // cone partem do próprio personagem.
      const limite = mode === "lineCustom" ? maxRange : 0;
      const res = await placeShapeTemplate(actor, spec, persistFlags, filterFn, limite);
      return { proceed: res.ok, actors: res.actors || [], templateId: res?.templateId || null };
    }
    if (mode === "aura") {
      const res = await placeAuraTemplate(actor, radius, persistFlags, filterFn);
      return { proceed: true, actors: (res?.actors) || [], templateId: res?.templateId || null };
    } else {
      const res = await placeAreaTemplate(actor, radius, persistFlags, filterFn, maxRange);
      return { proceed: res.ok, actors: res.actors || [], templateId: res?.templateId || null };
    }
  } catch (e) {
    console.warn("Ligeia | erro ao posicionar template; seguindo sem ele:", e);
    return { proceed: true, actors: null, templateId: null };
  }
}
