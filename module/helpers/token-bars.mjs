/**
 * BARRAS DE RECURSO NO TOKEN
 * ===========================================================================
 * Desenha, logo ABAIXO de cada token, até três barrinhas — Pontos de Vida,
 * Pontos de Magia e Pontos Heroicos — lendo direto da ficha do ator.
 *
 * Quais barras aparecem é escolhido na própria ficha (`system.tokenBars`), com
 * uma caixinha "no token" ao lado de cada recurso. Quem pode marcar/desmarcar
 * é quem pode editar a ficha: o dono do personagem ou o Narrador.
 *
 * QUEM VÊ O QUÊ
 *  - Narrador: vê tudo o que estiver marcado.
 *  - Dono do ator: vê as barras do próprio personagem.
 *  - Demais jogadores:
 *      · personagem  → veem (é o grupo; para esconder, desmarque a barra);
 *      · NPC/veículo → NÃO veem, a menos que o Narrador marque
 *        "barras visíveis aos jogadores" naquele NPC (`tokenBars.players`).
 *
 * As barras nativas do Foundry (bar1/bar2) ficam ocultas nos atores deste
 * sistema para não duplicar a informação — o Narrador pode voltar atrás na
 * configuração "Barras de recurso no token", nas opções do sistema.
 *
 * Compatível com V13 e V14, e com PIXI v7 (beginFill/endFill) e v8
 * (rect/fill) — ver `fillRect()`.
 */

import { DEATH_HP } from "./wounds.mjs";

const SYSTEM = "ligeia-rpg";
const BARS_SETTING = "tokenResourceBars";

/** Tipos de ator deste sistema que recebem as barras. */
const ACTOR_TYPES = ["personagem", "npc", "veiculo"];

/** Tipos de ator cujas barras ficam escondidas dos jogadores por padrão. */
const GM_ONLY_TYPES = ["npc", "veiculo"];

/**
 * As três barras, na ordem em que são empilhadas (de cima para baixo).
 * As cores acompanham a ficha elegante (--fe-hp-3 / --fe-mp-3 / --fe-ph-3).
 */
const BAR_DEFS = [
  { key: "hp", path: "hp", color: 0xd23232, dark: 0x5e0b0b },
  { key: "mp", path: "mp", color: 0x3a8ee0, dark: 0x123a6b },
  { key: "heroic", path: "heroic", color: 0x38b768, dark: 0x134f2c },
];

/* ======================================================================== */
/*  Configuração                                                            */
/* ======================================================================== */

/** Registra a opção de mundo que liga/desliga as barras do sistema. */
export function registerTokenBarSettings() {
  game.settings.register(SYSTEM, BARS_SETTING, {
    name: "Barras de recurso no token",
    hint:
      "Desenha PV, PM e Pontos Heroicos logo abaixo de cada token (escolha quais na ficha de cada personagem). " +
      "Desligue para voltar às barras padrão do Foundry.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => redrawAllTokens(),
  });
}

/** As barras do sistema estão ligadas neste mundo? */
function barsEnabled() {
  try {
    return game.settings.get(SYSTEM, BARS_SETTING) !== false;
  } catch (e) {
    return true; // antes do registro da opção
  }
}

/* ======================================================================== */
/*  Regras de visibilidade                                                  */
/* ======================================================================== */

/**
 * O usuário atual pode ver as barras deste ator?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function barsVisibleFor(actor) {
  if (!actor) return false;
  if (!ACTOR_TYPES.includes(actor.type)) return false;
  // Narrador vê tudo.
  if (game.user?.isGM) return true;
  // O dono vê o próprio personagem (mesmo sendo um NPC entregue a ele).
  if (actor.isOwner) return true;
  // NPCs e veículos ficam escondidos até o Narrador liberar aquele ator.
  if (GM_ONLY_TYPES.includes(actor.type)) {
    return !!actor.system?.tokenBars?.players;
  }
  // Personagens do grupo: visíveis (para esconder, desmarque a barra).
  return true;
}

/**
 * Lista das barras que devem ser desenhadas para este token, já filtradas
 * pelas caixinhas da ficha e pela permissão do usuário atual.
 * @param {Token} token
 * @returns {Array<{key:string, value:number, max:number, temp:number, pct:number,
 *                  woundPct:number, color:number, dark:number}>}
 */
export function barsForToken(token) {
  const actor = token?.actor;
  if (!actor || !barsVisibleFor(actor)) return [];
  const cfg = actor.system?.tokenBars || {};
  const res = actor.system?.resources || {};
  const out = [];
  for (const def of BAR_DEFS) {
    if (cfg[def.key] === false) continue; // desmarcada na ficha
    const r = res[def.path] || {};
    const max = Number(r.max) || 0;
    const value = Number(r.value) || 0;
    const temp = def.key === "hp" ? (Number(r.temp) || 0) : 0;
    // Sem máximo (ex.: PH de um NPC nível 0) não há o que desenhar.
    if (max <= 0 && value <= 0 && temp <= 0) continue;
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    // PV negativos (níveis de ferimento): fatia da barra pintada de escuro.
    const woundPct = def.key === "hp" && value < 0
      ? Math.max(0, Math.min(1, Math.abs(value) / Math.abs(DEATH_HP)))
      : 0;
    // Sobrevida (PV temporário) como fatia extra sobre a barra de PV.
    const tempPct = max > 0 ? Math.max(0, Math.min(1, temp / max)) : 0;
    out.push({ key: def.key, value, max, temp, pct, tempPct, woundPct, color: def.color, dark: def.dark });
  }
  return out;
}

/* ======================================================================== */
/*  Desenho                                                                 */
/* ======================================================================== */

/**
 * Preenche um retângulo arredondado funcionando tanto no PIXI v7
 * (beginFill/drawRoundedRect/endFill) quanto no v8 (roundRect/fill).
 */
function fillRect(g, x, y, w, h, radius, color, alpha = 1) {
  if (w <= 0 || h <= 0) return;
  const r = Math.min(radius, h / 2, w / 2);
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
    if (r > 0) g.drawRoundedRect(x, y, w, h, r);
    else g.drawRect(x, y, w, h);
    g.endFill();
  } else {
    if (r > 0) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
    g.fill({ color, alpha });
  }
}

/** Altura de cada barrinha, proporcional ao grid e ao tamanho do token. */
function barHeight(token) {
  const grid = canvas?.dimensions?.size || 100;
  const squares = Number(token?.document?.height) || 1;
  // Tokens grandes ganham barras um pouco mais grossas, sem exagero.
  const scale = Math.min(1 + (squares - 1) * 0.2, 2);
  return Math.max(4, Math.round((grid / 16) * scale));
}

/**
 * Chave de estado: enquanto ela não mudar, não há motivo para redesenhar.
 * (O hook `refreshToken` dispara a cada quadro de animação de movimento.)
 */
function stateKey(token, bars) {
  const parts = bars.map((b) => `${b.key}:${b.value}/${b.max}+${b.temp}`);
  return `${parts.join("|")}#${token.w}x${token.h}#${barHeight(token)}`;
}

/**
 * Reposiciona o nome do token para caber abaixo das barras.
 * Idempotente: recalcula sempre a partir da geometria, nunca somando.
 * Só assume o controle do nome enquanto houver barras; quando elas somem,
 * devolve a posição padrão uma vez e larga o controle — tokens que nunca
 * tiveram barras não são tocados.
 */
function placeNameplate(token, offset) {
  const np = token?.nameplate;
  if (!np || np.destroyed) return;
  if (offset <= 0 && !token._ligeiaNamePlaced) return;
  try {
    np.y = token.h + (np.height || 0) / 2 + offset;
    token._ligeiaNamePlaced = offset > 0;
  } catch (e) { /* layout do nome mudou numa versão futura — ignora */ }
}

/**
 * Desenha (ou apaga) as barras deste token.
 * @param {Token} token
 * @param {boolean} [force] Ignora a chave de estado e redesenha de qualquer jeito.
 */
export function drawTokenBars(token, force = false) {
  if (!token || token.destroyed) return;

  const clear = () => {
    if (token._ligeiaBars && !token._ligeiaBars.destroyed) {
      try { token.removeChild(token._ligeiaBars); } catch (e) { /* já solto */ }
      try { token._ligeiaBars.destroy({ children: true }); } catch (e) { /* já destruído */ }
    }
    token._ligeiaBars = null;
    token._ligeiaBarsKey = "";
    placeNameplate(token, 0);
  };

  const actor = token.actor;
  const isLigeia = !!actor && ACTOR_TYPES.includes(actor.type);

  // Fora do sistema ou com as barras desligadas: devolve as nativas e sai.
  if (!isLigeia || !barsEnabled()) {
    if (token.bars) token.bars.visible = true;
    if (token._ligeiaBars) clear();
    return;
  }

  // As barras do sistema substituem as nativas (senão o PV apareceria duas vezes).
  if (token.bars) token.bars.visible = false;

  const bars = barsForToken(token);
  if (!bars.length) { clear(); return; }

  const key = stateKey(token, bars);
  if (!force && token._ligeiaBarsKey === key && token._ligeiaBars && !token._ligeiaBars.destroyed) {
    // Nada mudou; só garante que o nome continua abaixo das barras.
    const h = barHeight(token);
    placeNameplate(token, bars.length * (h + 1) + 2);
    return;
  }

  clear();

  const w = token.w;
  const h = barHeight(token);
  const gap = 1;
  const radius = Math.max(1, Math.floor(h / 3));
  const container = new PIXI.Container();
  container.x = 0;
  container.y = token.h + 2;

  bars.forEach((bar, i) => {
    const g = new PIXI.Graphics();
    const y = i * (h + gap);
    // Trilha (fundo) com uma moldura escura para legibilidade sobre o mapa.
    fillRect(g, -1, y - 1, w + 2, h + 2, radius + 1, 0x000000, 0.65);
    fillRect(g, 0, y, w, h, radius, 0x14100d, 0.95);
    // Ferimento: fatia escura à esquerda quando os PV estão negativos.
    if (bar.woundPct > 0) fillRect(g, 0, y, w * bar.woundPct, h, radius, bar.dark, 1);
    // Preenchimento do recurso.
    if (bar.pct > 0) fillRect(g, 0, y, w * bar.pct, h, radius, bar.color, 1);
    // Brilho sutil na metade de cima do preenchimento.
    if (bar.pct > 0 && h >= 5) fillRect(g, 0, y, w * bar.pct, h / 2, radius, 0xffffff, 0.18);
    // Sobrevida (PV temporário) em ciano, logo após o preenchimento.
    if (bar.tempPct > 0) {
      const start = w * Math.min(1, bar.pct);
      const width = Math.min(w - start, w * bar.tempPct);
      fillRect(g, start, y, width, h, radius, 0x3fd4d4, 0.9);
    }
    container.addChild(g);
  });

  token.addChild(container);
  token._ligeiaBars = container;
  token._ligeiaBarsKey = key;
  placeNameplate(token, bars.length * (h + gap) + 2);
}

/** Redesenha as barras de todos os tokens da cena atual. */
export function redrawAllTokens() {
  for (const t of canvas?.tokens?.placeables || []) drawTokenBars(t, true);
}

/** Redesenha as barras de todos os tokens de um ator (em qualquer cena ativa). */
export function redrawTokensOf(actor) {
  if (!actor) return;
  for (const t of canvas?.tokens?.placeables || []) {
    if (t.actor?.id === actor.id || t.document?.actorId === actor.id) drawTokenBars(t, true);
  }
}

/* ======================================================================== */
/*  Hooks                                                                   */
/* ======================================================================== */

/** Liga as barras ao ciclo de vida dos tokens. */
export function registerTokenBarHooks() {
  // Token desenhado pela primeira vez (ou recriado).
  Hooks.on("drawToken", (token) => drawTokenBars(token, true));

  // Refresh (movimento, zoom, mudança de dados). A chave de estado evita
  // redesenhar a cada quadro da animação.
  Hooks.on("refreshToken", (token) => drawTokenBars(token));

  // Mudou PV/PM/PH, as caixinhas da ficha ou as permissões (quem enxerga o
  // quê pode ter mudado junto) → redesenha os tokens daquele ator.
  Hooks.on("updateActor", (actor, changes) => {
    const sys = changes?.system;
    const mexeuNasBarras = !!sys && (sys.resources !== undefined || sys.tokenBars !== undefined);
    if (!mexeuNasBarras && changes?.ownership === undefined) return;
    redrawTokensOf(actor);
  });

  // Token redimensionado (categoria de tamanho) ou trocado de ator.
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (changes.width === undefined && changes.height === undefined
      && changes.actorId === undefined && changes.actorData === undefined
      && changes.delta === undefined) return;
    const t = tokenDoc.object;
    if (t) drawTokenBars(t, true);
  });

  // Cena carregada.
  Hooks.on("canvasReady", () => redrawAllTokens());
}
