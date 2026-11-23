/**
 * ECONOMIA DE AÇÕES (opcional)
 * ===========================================================================
 * Cada personagem tem, por rodada:
 *
 *   1 ação padrão · 1 ação de movimento · 1 ação simples · 1 reação
 *   e ações livres à vontade.
 *
 * Tudo se recupera no INÍCIO DO TURNO de quem age. Efeitos ativos podem dar
 * ações a mais ("+1 ação simples enquanto estiver em Postura Veloz") ou
 * tirá-las ("-1 ação de movimento enquanto estiver Enraizado"), o que deixa o
 * personagem mais rápido ou mais travado sem mexer em nenhuma outra regra.
 *
 * DUPLO DESLOCAMENTO: correr — passar do deslocamento, a faixa AMARELA do
 * medidor — custa a ação de movimento E a ação padrão, a menos que um efeito
 * de CORRIDA esteja ativo; aí sai só com a de movimento.
 *
 * A mecânica inteira é OPCIONAL: fica desligada até que o Narrador a ligue em
 * Configurações → Opções do Sistema → "Economia de ações". Com ela desligada,
 * nada nesta página roda, nenhuma ficha mostra ações e nenhuma ação é barrada.
 */

import { actionMods, canRunFreely } from "./effects.mjs";
import { expandConditions } from "./conditions.mjs";

const SYSTEM = "ligeia-rpg";
const SETTING_ON = "actionEconomy";
const SETTING_STRICT = "actionEconomyStrict";

/**
 * Os tipos de ação, na ordem em que aparecem na ficha.
 *  base      = quantas o personagem tem por rodada antes dos efeitos
 *  unlimited = ação livre: não se conta nem se gasta
 */
export const ACTION_TYPES = {
  standard: { label: "Ação padrão", short: "Padrão", icon: "⬢", base: 1 },
  movement: { label: "Ação de movimento", short: "Movimento", icon: "➤", base: 1 },
  simple: { label: "Ação simples", short: "Simples", icon: "◆", base: 1 },
  reaction: { label: "Reação", short: "Reação", icon: "↺", base: 1 },
  free: { label: "Ação livre", short: "Livre", icon: "∞", base: 0, unlimited: true },
};

/** Os tipos CONTADOS (a livre fica de fora: é infinita). */
export const COUNTED_ACTIONS = Object.keys(ACTION_TYPES).filter((k) => !ACTION_TYPES[k].unlimited);

/**
 * Os tipos que entram no TETO POR TURNO de condições como Pasmo
 * ("faz apenas uma ação por turno"). A reação fica de fora: ela acontece
 * fora do próprio turno, então não disputa esse teto.
 */
export const CAP_ACTIONS = ["standard", "movement", "simple"];

/** Rótulo de um tipo de ação (ou o próprio id, se for desconhecido). */
export function actionLabel(tipo) {
  return ACTION_TYPES[tipo]?.label || tipo || "";
}

/* ======================================================================== */
/*  Configuração                                                            */
/* ======================================================================== */

/** Registra as opções de mundo da economia de ações. */
export function registerActionSettings() {
  game.settings.register(SYSTEM, SETTING_ON, {
    name: "Economia de ações",
    hint:
      "Liga a contagem de ações por rodada: 1 ação padrão, 1 de movimento, 1 simples, 1 reação e livres à vontade, " +
      "tudo recuperado no início do turno. Efeitos podem dar ou tirar ações, e correr (passar do deslocamento) " +
      "custa movimento + padrão. Desligada, nada disso acontece.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      for (const app of Object.values(ui.windows || {})) app.render?.(false);
      for (const a of game.actors ?? []) a.sheet?.rendered && a.sheet.render(false);
    },
  });

  game.settings.register(SYSTEM, SETTING_STRICT, {
    name: "Barrar ação sem a ação disponível",
    hint:
      "Com a economia de ações ligada: impede de usar o que exige uma ação que já acabou. " +
      "Desmarque para apenas avisar e deixar passar (útil em mesas que preferem combinar na conversa).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

/** A economia de ações está ligada neste mundo? */
export function actionEconomyOn() {
  try {
    return globalThis.game?.settings?.get(SYSTEM, SETTING_ON) === true;
  } catch (e) {
    return false; // antes do registro da opção
  }
}

/** Ação que falta BARRA o uso (ou só avisa)? */
export function actionEconomyStrict() {
  try {
    return globalThis.game?.settings?.get(SYSTEM, SETTING_STRICT) !== false;
  } catch (e) {
    return true;
  }
}

/* ======================================================================== */
/*  O que as condições limitam                                              */
/* ======================================================================== */

/**
 * Os limites que as condições ATIVAS impõem às ações do personagem.
 *
 * Estar Atordoado, Inconsciente ou Paralisado tira as ações do turno;
 * Imobilizado (e Agarrado, que o implica) tira a de movimento; Pasmo (e
 * Dominado, que o implica) deixa só uma ação no turno inteiro. A tabela vive
 * em CONFIG.LIGEIA.conditionActions, então a mesa pode reescrevê-la.
 *
 * @returns {{tetos:Record<string,number>, cap:(number|null), motivos:string[]}}
 *          tetos  = teto por tipo (ausente = sem teto)
 *          cap    = teto de ações no turno somando os tipos de CAP_ACTIONS
 *          motivos= rótulos das condições que apertaram, para explicar
 */
export function conditionActionLimits(actor) {
  const tetos = {};
  let cap = null;
  const motivos = [];
  const tabela = globalThis.CONFIG?.LIGEIA?.conditionActions || {};
  const defs = globalThis.CONFIG?.LIGEIA?.conditions || {};
  // As condições implicadas contam: quem está Agarrado já está Imobilizado.
  const ativas = expandConditions(actor?.system?.conditions || []);

  for (const id of ativas) {
    const regra = tabela[id];
    if (!regra) continue;
    let apertou = false;
    // "all" vale para todo tipo contado, inclusive a reação.
    if (regra.all !== undefined) {
      for (const t of COUNTED_ACTIONS) {
        const v = Math.max(0, Number(regra.all) || 0);
        if (tetos[t] === undefined || v < tetos[t]) { tetos[t] = v; apertou = true; }
      }
    }
    for (const t of COUNTED_ACTIONS) {
      if (regra[t] === undefined) continue;
      const v = Math.max(0, Number(regra[t]) || 0);
      if (tetos[t] === undefined || v < tetos[t]) { tetos[t] = v; apertou = true; }
    }
    if (regra.cap !== undefined) {
      const v = Math.max(0, Number(regra.cap) || 0);
      if (cap === null || v < cap) { cap = v; apertou = true; }
    }
    if (apertou) motivos.push(defs[id]?.label || id);
  }
  return { tetos, cap, motivos };
}

/* ======================================================================== */
/*  O estoque de ações                                                      */
/* ======================================================================== */

/**
 * Quantas ações de cada tipo o personagem tem POR RODADA, já contando o que
 * os efeitos ativos dão e tiram e o que as condições ativas limitam. Nunca
 * fica negativo: um efeito que tire mais do que existe simplesmente zera
 * aquele tipo, e um teto de condição corta o que passar dele.
 * @returns {Record<string, number>}
 */
export function actionMaxFor(actor) {
  const mods = actionMods(actor);
  const { tetos } = conditionActionLimits(actor);
  const max = {};
  for (const tipo of COUNTED_ACTIONS) {
    const bruto = Math.max(0, (ACTION_TYPES[tipo].base || 0) + (Number(mods[tipo]) || 0));
    max[tipo] = tetos[tipo] === undefined ? bruto : Math.min(bruto, tetos[tipo]);
  }
  return max;
}

/**
 * O estoque atual: para cada tipo, quanto resta e quanto cabe.
 *
 * O que está gravado na ficha é o RESTANTE (`system.actions`). Um tipo que
 * ainda não foi gravado conta como cheio — é o estado de quem acabou de
 * entrar em cena —, e o restante nunca passa do máximo (um efeito que caiu
 * pode ter encolhido o teto depois do gasto).
 */
export function actionPoolFor(actor) {
  const max = actionMaxFor(actor);
  const { cap, motivos } = conditionActionLimits(actor);
  const atual = actor?.system?.actions || {};
  const pool = {};
  for (const tipo of COUNTED_ACTIONS) {
    const bruto = atual[tipo];
    const resta = bruto === undefined || bruto === null ? max[tipo] : Number(bruto) || 0;
    const value = Math.max(0, Math.min(resta, max[tipo]));
    pool[tipo] = {
      key: tipo,
      label: ACTION_TYPES[tipo].label,
      short: ACTION_TYPES[tipo].short,
      icon: ACTION_TYPES[tipo].icon,
      value,
      max: max[tipo],
      // Quanto dá para usar AGORA — o mesmo que resta, a não ser que um teto
      // de turno (Pasmo e parecidas) já tenha sido alcançado.
      available: value,
      cappedBy: "",
      // Pontinhos para a ficha desenhar (cheios primeiro).
      pips: Array.from({ length: max[tipo] }, (_, i) => i < value),
    };
  }

  // TETO POR TURNO: "faz apenas uma ação por turno" não olha o tipo, olha
  // quantas já saíram. O que sobra do teto limita todos os tipos que entram
  // nele, sem mexer no que cada um ainda teria.
  if (cap !== null) {
    const usadas = CAP_ACTIONS.reduce((n, t) => n + Math.max(0, (pool[t]?.max || 0) - (pool[t]?.value || 0)), 0);
    const sobra = Math.max(0, cap - usadas);
    for (const t of CAP_ACTIONS) {
      if (!pool[t]) continue;
      pool[t].available = Math.min(pool[t].value, sobra);
      if (pool[t].available < pool[t].value) pool[t].cappedBy = motivos.join(", ");
    }
    pool.cap = { total: cap, used: usadas, left: sobra, motivos };
  }
  return pool;
}

/** Só as entradas de tipo do estoque (sem o resumo do teto por turno). */
export function poolEntries(pool) {
  return COUNTED_ACTIONS.map((t) => pool[t]).filter(Boolean);
}

/** O personagem ainda tem esta ação? (livre e desconhecida sempre têm) */
export function hasAction(actor, tipo) {
  if (!tipo || tipo === "none" || tipo === "free") return true;
  if (!COUNTED_ACTIONS.includes(tipo)) return true;
  return actionPoolFor(actor)[tipo].available > 0;
}

/**
 * Gasta uma ação (ou várias de uma vez) do personagem.
 *
 * @param {Actor} actor
 * @param {string|string[]} tipos  um tipo, ou vários a gastar juntos
 * @param {object} [opts]
 * @param {string} [opts.motivo]  o que gastou, para a mensagem
 * @param {boolean} [opts.force]  gasta mesmo faltando (não barra)
 * @param {boolean} [opts.quiet]  não avisa na tela (quem chamou é que conta)
 * @returns {Promise<{ok:boolean, gastou:string[], faltou:string[], text:string}>}
 *          ok=false quer dizer que o uso deve ser ABORTADO.
 */
export async function spendActions(actor, tipos, { motivo = "", force = false, quiet = false } = {}) {
  const lista = (Array.isArray(tipos) ? tipos : [tipos])
    .filter((t) => t && t !== "none" && t !== "free" && COUNTED_ACTIONS.includes(t));
  if (!actionEconomyOn() || !lista.length) return { ok: true, gastou: [], faltou: [], text: "" };

  const pool = actionPoolFor(actor);
  // Conta quantas de cada tipo o uso pede (a mesma pode vir repetida).
  const pedido = new Map();
  for (const t of lista) pedido.set(t, (pedido.get(t) || 0) + 1);

  // Falta por tipo esgotado OU por teto de turno de uma condição (Pasmo e
  // parecidas). O teto também é cobrado no conjunto: pedir movimento +
  // padrão de uma vez com só uma ação de teto não passa.
  const faltou = [...pedido.entries()].filter(([t, n]) => pool[t].available < n).map(([t]) => t);
  const noTeto = [...pedido.entries()]
    .filter(([t]) => CAP_ACTIONS.includes(t)).reduce((n, [, q]) => n + q, 0);
  const estouraTeto = pool.cap ? noTeto > pool.cap.left : false;
  const { motivos } = conditionActionLimits(actor);
  if ((faltou.length || estouraTeto) && !force && actionEconomyStrict()) {
    const porCondicao = motivos.length && (estouraTeto || faltou.some((t) => pool[t].max === 0 || pool[t].cappedBy));
    const nomes = (faltou.length ? faltou : [...pedido.keys()]).map(actionLabel).join(" e ");
    if (!quiet) {
      ui.notifications?.warn(
        `${actor?.name || "O personagem"} não tem ${nomes} nesta rodada${motivo ? ` para ${motivo}` : ""}` +
        `${porCondicao ? ` — ${motivos.join(", ")}.` : "."}`,
      );
    }
    return { ok: false, gastou: [], faltou: faltou.length ? faltou : [...pedido.keys()], text: "" };
  }

  const update = {};
  const gastou = [];
  for (const [t, n] of pedido) {
    update[`system.actions.${t}`] = Math.max(0, pool[t].value - n);
    for (let i = 0; i < n; i++) gastou.push(t);
  }
  if (actor?.isOwner) await actor.update(update);

  const resumo = [...pedido.entries()]
    .map(([t, n]) => `${n > 1 ? `${n}× ` : ""}${actionLabel(t)}`).join(", ");
  const aviso = faltou.length
    ? ' <span class="lig-insufficient">(sem ação disponível!)</span>'
    : "";
  return {
    ok: true, gastou, faltou,
    text: `<div class="lig-action-line">Gastou: ${resumo}${aviso}</div>`,
  };
}

/** Devolve ações ao estoque (sem passar do máximo). */
export async function refundActions(actor, tipos) {
  const lista = (Array.isArray(tipos) ? tipos : [tipos]).filter((t) => COUNTED_ACTIONS.includes(t));
  if (!lista.length || !actor?.isOwner) return;
  const pool = actionPoolFor(actor);
  const update = {};
  for (const t of lista) {
    update[`system.actions.${t}`] = Math.min(pool[t].max, (update[`system.actions.${t}`] ?? pool[t].value) + 1);
  }
  await actor.update(update);
}

/**
 * Enche o estoque: o começo do turno devolve tudo.
 * @returns {Promise<boolean>} se mexeu em alguma coisa
 */
export async function restoreActions(actor) {
  if (!actor) return false;
  const max = actionMaxFor(actor);
  const pool = actionPoolFor(actor);
  const update = {};
  for (const t of COUNTED_ACTIONS) {
    if (pool[t].value !== max[t]) update[`system.actions.${t}`] = max[t];
  }
  // O turno novo começa parado: o acumulado de metros zera junto.
  if ((Number(actor.system?.actions?.moved) || 0) !== 0) update["system.actions.moved"] = 0;
  if (!Object.keys(update).length) return false;
  if (actor.isOwner) await actor.update(update);
  return true;
}

/* ======================================================================== */
/*  Correr: o duplo deslocamento                                            */
/* ======================================================================== */

/** Tolerância para a comparação de distâncias (medições do grid). */
const EPS = 1e-6;

/**
 * O que correr custa a este personagem, partindo do lugar.
 * Normalmente movimento + padrão; com um efeito de CORRIDA ativo, só a de
 * movimento.
 * @returns {string[]}
 */
export function runCost(actor) {
  return canRunFreely(actor) ? ["movement"] : ["movement", "standard"];
}

/**
 * Quais ações um deslocamento cobra, dado o que o personagem JÁ ANDOU neste
 * turno e onde ele vai parar.
 *
 * A regra tem duas faixas, as mesmas cores do medidor do token:
 *
 *   VERDE  (até o deslocamento) — uma ação. A de movimento, se houver; se
 *          ela já tiver sido gasta (ou não existir), a PADRÃO serve: quem
 *          não tem como se mover ainda pode usar a ação principal para isso.
 *   AMARELO (do deslocamento até o dobro) — a segunda ação, a padrão. É o
 *          duplo deslocamento, e é por isso que correr custa as duas.
 *
 * O que vale é o ACUMULADO do turno: andar 5m e depois mais 6m com 9m de
 * deslocamento cobra a de movimento no primeiro trecho e a padrão no
 * segundo, porque o segundo foi o que passou do deslocamento — e não duas
 * vezes o preço inteiro.
 *
 * Um efeito de CORRIDA dispensa a segunda faixa: correr sai pela ação de
 * movimento sozinha.
 *
 * @returns {string[]} as ações a gastar (pode ser vazio)
 */
export function movementCostFor(actor, antes, depois) {
  const desloc = Number(actor?.system?.secondary?.deslocamento) || 0;
  const de = Math.max(0, Number(antes) || 0);
  const para = Math.max(0, Number(depois) || 0);
  if (para <= de) return [];

  const custos = [];
  // Saiu do lugar: a primeira ação de deslocamento do turno.
  if (de <= EPS) {
    custos.push(actionPoolFor(actor).movement.available > 0 ? "movement" : "standard");
  }
  // Passou do deslocamento: entrou no amarelo e paga a segunda.
  if (desloc > 0 && de <= desloc + EPS && para > desloc + EPS && !canRunFreely(actor)) {
    custos.push("standard");
  }
  return custos;
}

/**
 * O ORÇAMENTO de deslocamento do personagem neste turno.
 *
 * Cada ação gasta em movimento compra UM deslocamento:
 *   · a ação de MOVIMENTO compra a primeira faixa — a verde;
 *   · a ação PADRÃO compra a seguinte — a amarela, o duplo deslocamento;
 *   · sem a de movimento, a padrão compra a PRIMEIRA faixa, que então
 *     aparece amarela: quem não tem como se mover ainda anda usando a ação
 *     principal, mas anda uma faixa só.
 *   · um efeito de CORRIDA dá a segunda faixa sem cobrar a padrão.
 *
 * O que já foi andado no turno conta: as faixas pagas não são cobradas de
 * novo, e o alcance que sobra é medido a partir do total do turno.
 *
 * @returns {{desloc:number, moved:number, bands:number, max:number,
 *            firstIsGreen:boolean, canMove:boolean}}
 *   bands  = quantas faixas o personagem pode ter andado ao fim do turno
 *   max    = o total em metros que isso dá (0 = não pode mais se mover)
 *   firstIsGreen = a primeira faixa é paga pela ação de movimento
 */
export function movementBudget(actor) {
  const desloc = Number(actor?.system?.secondary?.deslocamento) || 0;
  const moved = Math.max(0, Number(actor?.system?.actions?.moved) || 0);
  if (!actionEconomyOn()) {
    return { desloc, moved, bands: Infinity, max: Infinity, firstIsGreen: true, canMove: true };
  }

  const pool = actionPoolFor(actor);
  const temMov = pool.movement.available > 0;
  const temPad = pool.standard.available > 0;
  const corrida = canRunFreely(actor);

  // Faixas já pagas neste turno.
  let pagas = 0;
  if (moved > EPS) pagas = 1;
  if (desloc > 0 && moved > desloc + EPS) pagas = 2;

  let bands = pagas;
  let firstIsGreen = true;
  if (pagas === 0) {
    if (temMov) bands = 1;
    else if (temPad) { bands = 1; firstIsGreen = false; }
    // A segunda faixa: a corrida dá de graça; senão, é a padrão que paga —
    // e ela só pode pagar uma vez.
    if (bands === 1 && (corrida || (firstIsGreen && temPad))) bands = 2;
  } else if (pagas === 1) {
    if (corrida || temPad) bands = 2;
  }

  const max = desloc > 0 ? bands * desloc : (bands ? Infinity : 0);
  return { desloc, moved, bands, max, firstIsGreen, canMove: max > moved + EPS };
}

/**
 * A cor do rastro para um ponto do caminho, dado o orçamento do turno.
 *   verde    — dentro da faixa que a ação de movimento paga
 *   amarelo  — na faixa que a ação padrão paga (ou na primeira, quando é
 *              ela que está pagando)
 *   vermelho — além do que dá para pagar: esse passo não acontece
 * @returns {"green"|"yellow"|"red"}
 */
export function movementBandAt(orcamento, totalNoTurno) {
  const { desloc, max, firstIsGreen } = orcamento;
  if (totalNoTurno > max + EPS) return "red";
  if (desloc > 0 && totalNoTurno > desloc + EPS) return "yellow";
  return firstIsGreen ? "green" : "yellow";
}

/**
 * Cobra o deslocamento de um token que se moveu `metros`.
 *
 * Dentro do deslocamento: ação de movimento. Passou dele (faixa amarela do
 * medidor): o custo de correr. Acima do dobro o sistema não inventa regra —
 * cobra o mesmo de correr e deixa o aviso para a mesa.
 *
 * Nada é cobrado fora de combate, nem de quem não está no turno: arrastar
 * token para arrumar a cena não gasta a rodada de ninguém.
 *
 * @returns {Promise<string>} resumo do que foi gasto (ou "")
 */
export async function chargeMovement(actor, metros) {
  if (!actionEconomyOn() || !actor) return "";
  const dist = Number(metros) || 0;
  if (dist <= 0) return "";

  const desloc = Number(actor.system?.secondary?.deslocamento) || 0;
  const antes = Math.max(0, Number(actor.system?.actions?.moved) || 0);
  const depois = antes + dist;
  const custo = movementCostFor(actor, antes, depois);

  // O acumulado do turno fica guardado, mesmo quando o trecho não cobra
  // nada: é ele que sabe quando o próximo passo entra no amarelo.
  if (actor.isOwner) await actor.update({ "system.actions.moved": depois });
  if (!custo.length) {
    return `<div class="lig-action-line muted">Deslocou ${Math.round(dist)}m <span class="lig-cond-note">(${Math.round(depois)}m no turno)</span></div>`;
  }

  // Movimento nunca é barrado: o token já se moveu. Fica o registro — e o
  // aviso, quando a ação não existia.
  const res = await spendActions(actor, custo, { motivo: "se deslocar", force: true });
  if (!res.text) return "";
  const correu = desloc > 0 && depois > desloc + EPS;
  const nota = correu
    ? `<span class="lig-cond-note">(corrida: ${Math.round(depois)}m no turno, deslocamento ${desloc}m)</span>`
    : `<span class="lig-cond-note">(${Math.round(depois)}m de ${desloc}m)</span>`;
  return res.text.replace("</div>", ` ${nota}</div>`);
}

/* ======================================================================== */
/*  Hooks: recuperação no turno e cobrança do deslocamento                  */
/* ======================================================================== */

/** Só um Mestre processa, para não recuperar/cobrar em duplicidade. */
function mestreResponsavel() {
  const ativos = globalThis.game?.users?.filter?.((u) => u.isGM && u.active) || [];
  if (!ativos.length) return false;
  return ativos.sort((a, b) => a.id.localeCompare(b.id))[0]?.id === globalThis.game?.user?.id;
}

/**
 * Este cliente é quem deve gravar a recuperação deste ator?
 *
 * Um jogador dono conectado cuida do próprio personagem; sem nenhum, o
 * Mestre responsável cuida. Assim a ficha é atualizada uma vez só, mesmo com
 * a mesa inteira na sala.
 */
function souQuemGrava(actor) {
  if (!actor?.isOwner) return false;
  const dono = globalThis.game?.users?.find?.(
    (u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER"),
  );
  return dono ? dono.id === globalThis.game?.user?.id : mestreResponsavel();
}

/** Distância entre dois cantos de token, em metros da cena. */
export function distanceMoved(scene, de, para) {
  if (!de || !para) return 0;
  const dx = (para.x ?? 0) - (de.x ?? 0);
  const dy = (para.y ?? 0) - (de.y ?? 0);
  if (!dx && !dy) return 0;
  const gs = scene?.grid?.size || globalThis.canvas?.grid?.size || 100;
  const dist = scene?.grid?.distance ?? globalThis.canvas?.grid?.distance ?? 1.5;
  return (Math.hypot(dx, dy) / gs) * dist;
}

export function registerActionHooks() {
  // INÍCIO DO TURNO: quem entra em cena recupera tudo.
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!actionEconomyOn()) return;
    const mudouTurno =
      Object.prototype.hasOwnProperty.call(changed || {}, "turn") ||
      Object.prototype.hasOwnProperty.call(changed || {}, "round");
    if (!mudouTurno) return;
    const actor = combat?.combatant?.actor;
    if (!souQuemGrava(actor)) return;
    // Primeiro a rodada volta cheia...
    await restoreActions(actor);
    // ...e só então o que ele sustenta cobra o seu quinhão. O import é
    // tardio porque a sustentação precisa de spendActions daqui.
    const { sustainTurn } = await import("./sustain.mjs");
    await sustainTurn(actor, combat);
  });

  // COMEÇO DO COMBATE: todo mundo entra com a rodada inteira.
  Hooks.on("combatStart", async (combat) => {
    if (!actionEconomyOn()) return;
    for (const c of combat?.combatants ?? []) {
      if (souQuemGrava(c.actor)) await restoreActions(c.actor);
    }
  });

  // DESLOCAMENTO: guarda de onde o token saiu — e BARRA o que não dá para
  // pagar. Sem ação de movimento nem padrão, o personagem fica onde está;
  // com só uma delas, anda uma faixa e para. A trava respeita a opção
  // "Barrar ação sem a ação disponível": desligada, só avisa.
  Hooks.on("preUpdateToken", (tokenDoc, changed, options) => {
    if (!actionEconomyOn()) return;
    if (!("x" in changed) && !("y" in changed)) return;
    const de = { x: tokenDoc.x, y: tokenDoc.y };
    options.ligeiaMoveFrom = de;

    const actor = tokenDoc.actor;
    const combate = globalThis.game?.combat;
    // Fora de combate, ou fora do turno de quem se move, ninguém é barrado:
    // arrumar a cena não gasta — nem trava — a rodada de ninguém.
    if (!actor || !combate?.started) return;
    if (combate.combatant?.actor?.id !== actor.id) return;

    const para = { x: changed.x ?? de.x, y: changed.y ?? de.y };
    const metros = distanceMoved(tokenDoc.parent, de, para);
    if (metros <= 0) return;

    const orcamento = movementBudget(actor);
    if (orcamento.max === Infinity) return;
    const total = orcamento.moved + metros;
    if (total <= orcamento.max + EPS) return;

    const sobra = Math.max(0, orcamento.max - orcamento.moved);
    const motivo = !orcamento.canMove
      ? "não tem mais ação para se deslocar"
      : `só pode andar mais ${Math.floor(sobra)}m neste turno`;
    if (actionEconomyStrict()) {
      ui.notifications?.warn(`${actor.name} ${motivo}.`);
      return false; // o token fica onde está
    }
    ui.notifications?.warn(`${actor.name} ${motivo} — passou mesmo assim.`);
    return undefined;
  });

  // ...e cobra a ação quando ele chega, se for a vez dele num combate.
  Hooks.on("updateToken", async (tokenDoc, changed, options, userId) => {
    if (!actionEconomyOn()) return;
    if (userId !== game.user.id) return; // quem arrastou é quem cobra
    if (!("x" in changed) && !("y" in changed)) return;
    const actor = tokenDoc.actor;
    if (!actor?.isOwner) return;
    const combate = game.combat;
    if (!combate?.started) return;
    if (combate.combatant?.actor?.id !== actor.id) return;

    const metros = distanceMoved(tokenDoc.parent, options?.ligeiaMoveFrom, { x: tokenDoc.x, y: tokenDoc.y });
    const texto = await chargeMovement(actor, metros);
    if (texto) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor, token: tokenDoc }),
        content: `<div class="ligeia-roll-flavor">${texto}</div>`,
      });
    }
  });
}
