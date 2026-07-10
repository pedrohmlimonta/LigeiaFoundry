/**
 * Efeitos de MOVIMENTO das ações: teleporte, empurrar, puxar, lateral e
 * telecinese (posicionamento livre).
 *
 * Regras de acionamento (iguais às do resto da ação):
 *   - só CD fixa ativa .......... move se o total do ataque ≥ CD
 *   - só rolagem resistida ...... move se superar a defesa do alvo
 *   - ambas ativas .............. precisa passar nas duas
 *   - nenhuma ativa ............. move sempre (automático)
 *
 * Tipos de movimento:
 *   teleport — instantâneo, IGNORA paredes
 *   push     — afasta o alvo do conjurador (físico, barrado por paredes)
 *   pull     — puxa o alvo na direção do conjurador (físico)
 *   lateral  — desloca o alvo perpendicularmente (físico)
 *   place    — telecinese: escolhe-se o ponto de destino (físico por padrão)
 *
 * O movimento pode afetar os ALVOS ou o PRÓPRIO conjurador ("self"). Nos modos
 * direcionais com "self", a referência de direção é o primeiro alvo atingido.
 *
 * Permissões: mover o token de outro jogador exige propriedade. Quando o
 * usuário não pode mover o token, o pedido é repassado ao Mestre via socket.
 */

const SOCKET = "system.ligeia-rpg";
const EPS = 1e-6;

/* ------------------------------------------------------------------ */
/*  Geometria                                                          */
/* ------------------------------------------------------------------ */

function gridSize() { return canvas?.grid?.size || 100; }
function gridDistance() { return canvas?.grid?.distance || 1; }

/** Metros → pixels da cena. */
function metersToPx(m) { return (Number(m) || 0) / gridDistance() * gridSize(); }
/** Pixels → metros da cena. */
function pxToMeters(px) { return (px / gridSize()) * gridDistance(); }

/** Centro (px) de um token. */
function centerOf(tokenDoc) {
  const obj = tokenDoc?.object;
  if (obj?.center) return { x: obj.center.x, y: obj.center.y };
  const gs = gridSize();
  return {
    x: (tokenDoc?.x ?? 0) + ((tokenDoc?.width ?? 1) * gs) / 2,
    y: (tokenDoc?.y ?? 0) + ((tokenDoc?.height ?? 1) * gs) / 2,
  };
}

/** Converte um centro (px) na posição de canto (x,y) do token. */
function centerToTopLeft(tokenDoc, center) {
  const gs = gridSize();
  return {
    x: center.x - ((tokenDoc?.width ?? 1) * gs) / 2,
    y: center.y - ((tokenDoc?.height ?? 1) * gs) / 2,
  };
}

/** Vetor unitário de A para B (ou null se coincidentes). */
function unitVector(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  return { x: dx / len, y: dy / len, len };
}

/** Encaixa um ponto no centro da casa do grid (se possível). */
function snapCenter(pt) {
  try {
    const mode = CONST.GRID_SNAPPING_MODES?.CENTER ?? 0;
    return canvas.grid.getSnappedPoint ? canvas.grid.getSnappedPoint({ x: pt.x, y: pt.y }, { mode }) : pt;
  } catch (e) {
    return pt;
  }
}

/**
 * Primeiro ponto de colisão com parede entre dois pontos (ou null).
 * Usa o backend de polígonos de movimento do Foundry.
 */
function firstWallHit(origin, dest) {
  try {
    const backend = CONFIG?.Canvas?.polygonBackends?.move;
    if (!backend?.testCollision) return null;
    const hit = backend.testCollision(origin, dest, { type: "move", mode: "closest" });
    return hit || null;
  } catch (e) {
    return null;
  }
}

/**
 * Limita o destino ao primeiro obstáculo entre origem e destino.
 * @returns {{point:{x,y}, blocked:boolean}}
 */
function clampToWalls(origin, dest) {
  const hit = firstWallHit(origin, dest);
  if (!hit) return { point: dest, blocked: false };
  // Recua alguns pixels para não ficar em cima da parede.
  const u = unitVector(origin, { x: hit.x, y: hit.y });
  const back = Math.min(gridSize() * 0.1, 8);
  const point = u
    ? { x: hit.x - u.x * back, y: hit.y - u.y * back }
    : { x: hit.x, y: hit.y };
  return { point, blocked: true };
}

/* ------------------------------------------------------------------ */
/*  Ações de movimento próprias (deslize animado, sem gastar movimento) */
/* ------------------------------------------------------------------ */

/** Nomes das ações de movimento registradas pelo sistema. */
const FORCED_WALLS = "ligeiaForced";
const FORCED_NOWALLS = "ligeiaForcedNoWalls";

/**
 * Registra ações de movimento usadas pelos efeitos (empurrar, puxar, lateral,
 * telecinese). Diferente de "displace"/"blink" (que são teleporte), estas
 * ANIMAM o token deslizando até o destino, como um deslocamento normal — mas
 * não consomem o deslocamento do alvo (`measure: false`).
 *
 * Chamada no hook `init`. Se a API não existir, é ignorada em silêncio.
 */
export function registerForcedMovementActions() {
  const actions = CONFIG?.Token?.movement?.actions;
  if (!actions) return;
  const common = {
    order: 90,
    teleport: false,   // percorre o caminho (anima), não salta
    measure: false,    // não consome o deslocamento do alvo
    visualize: true,
    canSelect: () => false,  // não aparece para o usuário escolher
    getCostFunction: () => () => 0,
    getAnimationOptions: () => ({}),
  };
  try {
    actions[FORCED_WALLS] = {
      ...common,
      label: "Movimento forçado",
      icon: "fa-solid fa-hand-back-fist",
      walls: "move",   // barrado por paredes
    };
    actions[FORCED_NOWALLS] = {
      ...common,
      label: "Movimento forçado (atravessa)",
      icon: "fa-solid fa-hand-sparkles",
      walls: null,     // atravessa paredes
    };
  } catch (e) {
    console.warn("Ligeia | não foi possível registrar as ações de movimento:", e);
  }
}

/** A ação de movimento forçado está disponível nesta versão? */
function forcedActionName(ignoreWalls) {
  const actions = CONFIG?.Token?.movement?.actions;
  const name = ignoreWalls ? FORCED_NOWALLS : FORCED_WALLS;
  if (actions?.[name]) return name;
  // Sem as ações próprias: "walk" também anima (mas conta como deslocamento).
  return actions?.walk ? "walk" : null;
}

/* ------------------------------------------------------------------ */
/*  Aplicação do movimento (com repasse ao Mestre quando necessário)    */
/* ------------------------------------------------------------------ */

/** O usuário atual pode mover este token? */
function canMove(tokenDoc) {
  try { return tokenDoc.canUserModify(game.user, "update"); }
  catch (e) { return !!game.user.isGM; }
}

/**
 * Executa o movimento localmente (quem chama já tem permissão).
 * @param {boolean} teleport     salto instantâneo (ignora paredes)
 * @param {boolean} ignoreWalls  movimento físico que atravessa paredes
 */
async function applyMoveLocal(tokenDoc, centerDest, teleport, ignoreWalls = false) {
  const pos = centerToTopLeft(tokenDoc, centerDest);
  // Teleporte: "blink" salta direto. Físico: ação própria que ANIMA o deslize.
  const action = teleport ? "blink" : forcedActionName(ignoreWalls);
  try {
    if (typeof tokenDoc.move === "function" && action) {
      await tokenDoc.move({ x: pos.x, y: pos.y, action }, { ligeiaForced: true });
      return true;
    }
  } catch (e) {
    console.warn("Ligeia | TokenDocument#move falhou; usando update:", e);
  }
  try {
    // Fallback: update animado (físico) ou instantâneo (teleporte).
    await tokenDoc.update({ x: pos.x, y: pos.y }, { animate: !teleport, ligeiaForced: true });
    return true;
  } catch (e) {
    console.warn("Ligeia | falha ao mover token:", e);
    return false;
  }
}

/** Move um token, repassando ao Mestre se o usuário não tiver permissão. */
async function moveToken(tokenDoc, centerDest, teleport, ignoreWalls = false) {
  if (canMove(tokenDoc)) return applyMoveLocal(tokenDoc, centerDest, teleport, ignoreWalls);
  // Sem permissão: pede ao Mestre (via socket) para executar.
  game.socket?.emit(SOCKET, {
    type: "moveToken",
    sceneId: tokenDoc.parent?.id,
    tokenId: tokenDoc.id,
    center: centerDest,
    teleport: !!teleport,
    ignoreWalls: !!ignoreWalls,
  });
  return "relayed";
}

/** Apenas UM GM processa os pedidos (evita movimento duplicado). */
function isResponsibleGM() {
  const gms = game.users.filter((u) => u.isGM && u.active);
  if (!gms.length) return false;
  return gms.sort((a, b) => a.id.localeCompare(b.id))[0]?.id === game.user.id;
}

/** Registra o receptor de pedidos de movimento (executado pelo Mestre). */
export function registerMovementSocket() {
  game.socket?.on(SOCKET, async (payload) => {
    if (!game.user.isGM || !isResponsibleGM()) return;
    if (payload?.type !== "moveToken") return;
    const scene = game.scenes.get(payload.sceneId);
    const tokenDoc = scene?.tokens?.get(payload.tokenId);
    if (!tokenDoc || !payload.center) return;
    await applyMoveLocal(tokenDoc, payload.center, !!payload.teleport, !!payload.ignoreWalls);
  });
}

/* ------------------------------------------------------------------ */
/*  Escolha interativa de destino (teleporte / telecinese)             */
/* ------------------------------------------------------------------ */

/**
 * Deixa o usuário clicar um ponto no canvas. Mostra o alcance máximo.
 * Botão direito cancela.
 * @returns {Promise<{x,y}|null>} centro escolhido (px) ou null se cancelado.
 */
function pickPoint(originCenter, maxPx, hint) {
  if (!canvas?.ready) return Promise.resolve(null);
  ui.notifications?.info(hint || "Clique para escolher o destino (botão direito cancela).");

  return new Promise((resolve) => {
    const g = new PIXI.Graphics();
    canvas.controls.addChild(g);
    let finished = false;
    let cursor = { ...originCenter };

    const within = (pt) =>
      maxPx <= 0 || Math.hypot(pt.x - originCenter.x, pt.y - originCenter.y) <= maxPx + EPS;

    const redraw = () => {
      g.clear();
      if (maxPx > 0) {
        g.lineStyle(2, 0x66ccff, 0.5);
        g.drawCircle(originCenter.x, originCenter.y, maxPx);
      }
      const ok = within(cursor);
      const color = ok ? 0x2ecc40 : 0xff4136;
      g.lineStyle(2, color, 0.9);
      g.moveTo(originCenter.x, originCenter.y);
      g.lineTo(cursor.x, cursor.y);
      g.beginFill(color, 0.35);
      g.drawCircle(cursor.x, cursor.y, gridSize() * 0.22);
      g.endFill();
    };

    const getPoint = (event) => {
      try {
        if (typeof event.getLocalPosition === "function") return event.getLocalPosition(canvas.controls);
        if (event.data?.getLocalPosition) return event.data.getLocalPosition(canvas.controls);
      } catch (e) { /* ignora */ }
      return cursor;
    };

    const onMove = (event) => {
      if (finished) return;
      cursor = snapCenter(getPoint(event));
      redraw();
    };

    const cleanup = () => {
      finished = true;
      canvas.stage.off("mousemove", onMove);
      canvas.stage.off("mousedown", onConfirm);
      if (canvas.app?.view) canvas.app.view.oncontextmenu = null;
      try { g.destroy(); } catch (e) { /* ignora */ }
    };

    const onConfirm = (event) => {
      if (finished) return;
      const pt = snapCenter(getPoint(event));
      if (!within(pt)) {
        ui.notifications?.warn(`Fora do alcance máximo (${Math.round(pxToMeters(maxPx))}m).`);
        return; // continua esperando
      }
      event.stopPropagation?.();
      cleanup();
      resolve(pt);
    };

    const onCancel = () => { cleanup(); resolve(null); return false; };

    canvas.stage.on("mousemove", onMove);
    canvas.stage.on("mousedown", onConfirm);
    if (canvas.app?.view) canvas.app.view.oncontextmenu = onCancel;
    redraw();
  });
}

/* ------------------------------------------------------------------ */
/*  Execução do efeito de movimento de uma ação                        */
/* ------------------------------------------------------------------ */

/** Token ativo de um ator na cena. */
function tokenOf(actor) {
  const t = actor?.getActiveTokens?.(true)?.[0] || actor?.getActiveTokens?.()?.[0];
  return t?.document || null;
}

const KIND_LABEL = {
  teleport: "teleportado",
  push: "empurrado",
  pull: "puxado",
  lateral: "deslocado lateralmente",
  place: "movido (telecinese)",
};

/**
 * Calcula o destino de um movimento direcional.
 * @param {object} mv       config de movimento da ação
 * @param {{x,y}} moverC    centro do token que se move
 * @param {{x,y}} refC      centro da referência de direção
 * @param {boolean} isSelf  o que se move é o conjurador?
 */
function directionalDestination(mv, moverC, refC) {
  const px = metersToPx(mv.distance);
  if (px <= 0) return null;
  const u = unitVector(refC, moverC); // da referência para quem se move
  if (!u) return null;

  let dir;
  if (mv.kind === "push") {
    dir = { x: u.x, y: u.y };          // afasta da referência
  } else if (mv.kind === "pull") {
    dir = { x: -u.x, y: -u.y };        // aproxima da referência
  } else if (mv.kind === "lateral") {
    dir = mv.lateralSide === "left" ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  } else {
    return null;
  }

  // Puxar não deve ultrapassar a referência: limita à separação atual.
  let dist = px;
  if (mv.kind === "pull") dist = Math.min(px, Math.max(0, u.len - gridSize() * 0.5));
  if (dist <= 0) return null;

  return { x: moverC.x + dir.x * dist, y: moverC.y + dir.y * dist };
}

/**
 * Executa o efeito de movimento de uma ação sobre os alvos atingidos e/ou o
 * conjurador.
 *
 * @param {object}   opts
 * @param {Actor}    opts.caster        quem executa a ação
 * @param {object}   opts.action        a ação
 * @param {Array}    opts.hits          [{ actor, acertou, isSelf }]
 * @param {boolean}  opts.actionOk      a ação teve sucesso (CD/defesa)?
 * @param {Function} [opts.onBeforeMove] chamado UMA vez, logo antes do
 *   primeiro movimento de fato (após escolher o destino) — usado para tocar a
 *   animação presa ao token, de modo que ela acompanhe o deslocamento.
 * @returns {Promise<string>} HTML com as linhas para o chat
 */
export async function executeActionMovement({ caster, action, hits = [], actionOk = true, onBeforeMove = null }) {
  const mv = action?.movement;
  if (!mv?.enabled) return "";
  if (!canvas?.ready) return "";
  // Sem sucesso na ação (CD e/ou rolagem de defesa), nada se move.
  if (!actionOk) return "";

  // Teleporte = salto instantâneo. Os demais são FÍSICOS: animam o deslize.
  // "Ignorar paredes" num movimento físico o faz atravessar, mas ainda anima.
  const teleport = mv.kind === "teleport";
  const ignoreWalls = teleport || !!mv.ignoreWalls;
  const lines = [];

  const casterToken = tokenOf(caster);
  // Alvos atingidos que não são o próprio conjurador.
  const hitTargets = hits.filter((h) => h.acertou && !h.isSelf).map((h) => h.actor);

  let animPlayed = false;
  /** Toca a animação (uma única vez) imediatamente antes do 1º movimento. */
  const fireAnim = () => {
    if (animPlayed) return;
    animPlayed = true;
    try { onBeforeMove?.(); } catch (e) { console.warn("Ligeia | erro ao tocar animação do movimento:", e); }
  };

  /** Move um token para um centro, tratando paredes e permissão. */
  const doMove = async (tokenDoc, destCenter, nameLabel) => {
    fireAnim();
    let dest = mv.snap === false ? destCenter : snapCenter(destCenter);
    let blocked = false;
    if (!ignoreWalls) {
      const r = clampToWalls(centerOf(tokenDoc), dest);
      dest = r.point;
      blocked = r.blocked;
      if (mv.snap !== false) dest = snapCenter(dest);
    }
    const moved = pxToMeters(Math.hypot(dest.x - centerOf(tokenDoc).x, dest.y - centerOf(tokenDoc).y));
    const res = await moveToken(tokenDoc, dest, teleport, ignoreWalls);
    const verb = KIND_LABEL[mv.kind] || "movido";
    const dm = Math.round(moved * 10) / 10;
    if (res === "relayed") {
      lines.push(`<div class="lig-move-line"><strong>${nameLabel}</strong>: ${verb} ${dm}m <span class="lig-cond-note">(aplicado pelo Mestre)</span></div>`);
    } else if (res) {
      lines.push(`<div class="lig-move-line"><strong>${nameLabel}</strong>: ${verb} ${dm}m${blocked ? ' <span class="lig-cond-note">(parou na parede)</span>' : ""}</div>`);
    } else {
      lines.push(`<div class="lig-move-line muted"><strong>${nameLabel}</strong>: não foi possível mover.</div>`);
    }
  };

  /* ---- Movimento do PRÓPRIO conjurador ---- */
  if (mv.who === "self") {
    if (!casterToken) return "";

    const originC = centerOf(casterToken);
    let dest = null;

    if (mv.kind === "teleport" || mv.kind === "place") {
      dest = await pickPoint(originC, metersToPx(mv.distance),
        `Escolha o destino${mv.distance > 0 ? ` (até ${mv.distance}m)` : ""} — botão direito cancela.`);
      if (!dest) return "";
    } else {
      const ref = hitTargets[0] ? tokenOf(hitTargets[0]) : null;
      if (!ref) {
        ui.notifications?.warn("Este movimento precisa de um alvo como referência de direção.");
        return "";
      }
      // Para o conjurador, a referência é o alvo: "empurrar" o afasta do alvo.
      dest = directionalDestination(mv, originC, centerOf(ref));
    }
    if (!dest) return "";
    await doMove(casterToken, dest, caster.name);
    return lines.join("");
  }

  /* ---- Movimento dos ALVOS ---- */
  if (!hitTargets.length) return "";
  for (const tActor of hitTargets) {
    const tToken = tokenOf(tActor);
    if (!tToken) continue;
    const tCenter = centerOf(tToken);
    let dest = null;

    if (mv.kind === "teleport" || mv.kind === "place") {
      dest = await pickPoint(tCenter, metersToPx(mv.distance),
        `Destino de ${tActor.name}${mv.distance > 0 ? ` (até ${mv.distance}m)` : ""} — botão direito cancela.`);
      if (!dest) continue;
    } else {
      if (!casterToken) {
        ui.notifications?.warn("O conjurador precisa de um token na cena para empurrar/puxar.");
        return "";
      }
      dest = directionalDestination(mv, tCenter, centerOf(casterToken));
    }
    if (!dest) continue;
    await doMove(tToken, dest, tActor.name);
  }
  return lines.join("");
}

/* ------------------------------------------------------------------ */
/*  Condição Telecinese: trava o movimento próprio do alvo             */
/* ------------------------------------------------------------------ */

/**
 * Enquanto sob Telecinese, o alvo não se move por conta própria. Quem o
 * controla o reposiciona usando a ação (que passa por `ligeiaForced`), e o
 * Mestre pode movê-lo livremente. Sair do efeito (rolagem de resistência)
 * devolve o movimento.
 */
export function registerMovementHooks() {
  Hooks.on("preUpdateToken", (tokenDoc, changed, options) => {
    if (!("x" in changed) && !("y" in changed)) return;
    if (options?.ligeiaForced) return;     // movimento forçado pela ação
    if (game.user.isGM) return;            // o Mestre sempre pode mover
    const conds = tokenDoc.actor?.system?.conditions || [];
    if (!conds.includes("telecinese")) return;
    ui.notifications?.warn(`${tokenDoc.name} está sob Telecinese e não pode se mover sozinho.`);
    return false;
  });
}
