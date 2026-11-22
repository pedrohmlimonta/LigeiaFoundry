/**
 * CONJURAÇÃO DE CRIATURAS.
 *
 * Uma ação pode invocar fichas: arrasta-se o personagem, o NPC ou o veículo
 * para a ação, e toda vez que a ação é executada o jogador escolhe no mapa,
 * dentro do alcance, onde cada criatura aparece.
 *
 * O token conjurado é avulso (não vinculado à ficha original), então ferir a
 * criatura invocada não arranha a ficha de onde ela saiu. Quem conjurou
 * recebe o controle do token, e a duração em rodadas é guardada numa flag:
 * o avanço de rodada no combate remove o que venceu.
 */

import { resolveEffectValue } from "./effects.mjs";
import { createSummonAsGM } from "./gm-proxy.mjs";
import { pickPoint, metersToPx, centerOf } from "./movement.mjs";

/** Atitudes que a configuração oferece, traduzidas para o Foundry. */
const ATITUDES = {
  friendly: "FRIENDLY",
  neutral: "NEUTRAL",
  hostile: "HOSTILE",
  secret: "SECRET",
};

/**
 * Qual atitude o token conjurado recebe.
 * "same" copia a de quem conjurou — é o que faz o aliado de um NPC hostil
 * nascer hostil para os jogadores.
 * @returns {number|null} valor de CONST.TOKEN_DISPOSITIONS, ou null (padrão)
 */
export function dispositionFor(casterToken, escolha) {
  const D = globalThis.CONST?.TOKEN_DISPOSITIONS || {};
  if (!escolha || escolha === "same") {
    const d = casterToken?.disposition;
    return Number.isFinite(d) ? d : null;
  }
  const nome = ATITUDES[escolha];
  return nome && Number.isFinite(D[nome]) ? D[nome] : null;
}

/** O token de quem está conjurando (o primeiro controlado, ou o da ficha). */
function tokenDoQueConjura(actor) {
  const controlado = globalThis.canvas?.tokens?.controlled?.find?.((t) => t.actor === actor);
  if (controlado?.document) return controlado.document;
  const ativos = actor?.getActiveTokens?.(true) || actor?.getActiveTokens?.() || [];
  return ativos[0]?.document || ativos[0] || null;
}

/** As conjurações válidas de uma ação (ligadas e com ficha escolhida). */
export function conjuracoesDaAcao(action) {
  return (action?.summons || []).filter((s) => s && s.enabled !== false && s.actorUuid);
}

/**
 * Executa as conjurações de uma ação.
 *
 * Para cada criatura, pergunta quantas vezes for preciso onde ela aparece —
 * uma escolha por token, sempre medindo o alcance a partir de quem conjurou.
 * Botão direito cancela a criatura que falta (as já postas ficam).
 *
 * @param {object} args
 * @param {Actor} args.actor     quem conjura
 * @param {Item} args.item
 * @param {object} args.action
 * @param {number} [args.gasto]  o que foi canalizado (para @gasto na conta)
 * @returns {Promise<string>} HTML para o chat (vazio se não conjurou nada)
 */
export async function executarConjuracoes({ actor, item, action, gasto = 0 }) {
  const lista = conjuracoesDaAcao(action);
  if (!lista.length) return "";

  const cena = globalThis.canvas?.scene;
  if (!cena) {
    return '<div class="lig-summon-line muted">Conjuração: nenhuma cena aberta para colocar a criatura.</div>';
  }

  const casterToken = tokenDoQueConjura(actor);
  const origem = casterToken ? centerOf(casterToken) : null;
  const alcanceM = resolveEffectValue(action.range, actor, { gasto });
  const maxPx = origem && alcanceM > 0 ? metersToPx(alcanceM) : 0;
  const rodadaAtual = globalThis.game?.combat?.round ?? null;

  const postas = [];
  const avisos = [];
  for (const conj of lista) {
    const ficha = await fromUuid(conj.actorUuid);
    if (!ficha || ficha.documentName !== "Actor") {
      avisos.push(`${conj.actorName || "criatura"} (ficha não encontrada)`);
      continue;
    }

    const quantas = Math.max(1, Math.round(resolveEffectValue(conj.count, actor, { gasto }) || 1));
    const duracao = Math.max(0, Math.round(resolveEffectValue(conj.rounds, actor, { gasto })));
    let feitas = 0;
    for (let n = 0; n < quantas; n++) {
      const ordem = quantas > 1 ? ` (${n + 1}/${quantas})` : "";
      const centro = origem
        ? await pickPoint(origem, maxPx,
          `Onde ${ficha.name} aparece${ordem}? ${alcanceM > 0 ? `Alcance ${alcanceM}m. ` : ""}Botão direito cancela.`)
        : await pickPoint({ x: 0, y: 0 }, 0, `Onde ${ficha.name} aparece${ordem}?`);
      if (!centro) break; // desistiu: para esta criatura

      const res = await createSummonAsGM({
        actorUuid: ficha.uuid,
        sceneId: cena.id,
        center: centro,
        disposition: dispositionFor(casterToken, conj.disposition),
        hidden: !!conj.hidden,
        controlUserId: conj.giveControl !== false ? (globalThis.game?.user?.id || "") : "",
        summonFlag: {
          summonerUuid: actor?.uuid || "",
          itemName: item?.name || "",
          actionLabel: action?.label || "",
          rounds: duracao,
          createdRound: rodadaAtual,
          remaining: duracao,
        },
      });
      if (res?.ok) feitas++;
      else if (res?.noGM) { avisos.push(`${ficha.name} (nenhum Mestre conectado)`); break; }
      else if (res?.timeout) { avisos.push(`${ficha.name} (o Mestre não respondeu)`); break; }
      else { avisos.push(`${ficha.name} (${res?.error || "falhou"})`); break; }
    }

    if (feitas) {
      const quanto = feitas > 1 ? `${feitas}× ` : "";
      const quanto2 = duracao > 0 ? ` por ${duracao} rodada${duracao > 1 ? "s" : ""}` : "";
      postas.push(`${quanto}<strong>${ficha.name}</strong>${quanto2}`);
    }
  }

  const linhas = [];
  if (postas.length) linhas.push(`<div class="lig-summon-line">Conjurou: ${postas.join(", ")}</div>`);
  if (avisos.length) linhas.push(`<div class="lig-summon-line muted">Não conjurou: ${avisos.join(", ")}</div>`);
  return linhas.join("");
}

/* ======================================================================== */
/*  Duração: o que foi conjurado por N rodadas vai embora no fim delas      */
/* ======================================================================== */

/** Só um Mestre processa a expiração (senão o token sairia várias vezes). */
function mestreResponsavel() {
  const ativos = globalThis.game?.users?.filter?.((u) => u.isGM && u.active) || [];
  if (!ativos.length) return globalThis.game?.user?.isGM === true;
  return ativos.sort((a, b) => a.id.localeCompare(b.id))[0]?.id === globalThis.game?.user?.id;
}

/** A marca de conjuração de um token (ou null). */
export function summonFlagOf(tokenDoc) {
  const lig = tokenDoc?.getFlag?.("ligeia-rpg") ?? tokenDoc?.flags?.["ligeia-rpg"];
  return lig?.summon || null;
}

/**
 * Quantas rodadas faltam para a criatura ir embora, dada a rodada atual.
 * Devolve 0 quando venceu e null quando a conjuração não expira.
 */
export function roundsLeft(summon, rodadaAtual) {
  const total = Math.max(0, Math.round(Number(summon?.rounds) || 0));
  if (!total) return null; // fica até ser removida
  const inicio = Number(summon?.createdRound);
  if (!Number.isFinite(inicio) || !Number.isFinite(Number(rodadaAtual))) return total;
  return Math.max(0, total - (Number(rodadaAtual) - inicio));
}

/**
 * Remove da cena as criaturas cuja duração acabou. Chamada no avanço de
 * rodada do combate.
 * @returns {Promise<string[]>} nomes do que foi embora
 */
export async function expirarConjuracoes(rodadaAtual, cena = null) {
  const sc = cena || globalThis.canvas?.scene;
  if (!sc) return [];
  const vencidos = [];
  for (const tokenDoc of sc.tokens || []) {
    const summon = summonFlagOf(tokenDoc);
    if (!summon) continue;
    if (roundsLeft(summon, rodadaAtual) === 0) vencidos.push(tokenDoc);
  }
  if (!vencidos.length) return [];
  try {
    await sc.deleteEmbeddedDocuments("Token", vencidos.map((t) => t.id));
  } catch (e) {
    console.warn("Ligeia | falha ao dispensar criatura conjurada:", e);
    return [];
  }
  return vencidos.map((t) => t.name);
}

/** Liga a expiração das conjurações ao avanço de rodada. */
export function registerSummonHooks() {
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!Object.prototype.hasOwnProperty.call(changed || {}, "round")) return;
    if (!mestreResponsavel()) return;
    const idos = await expirarConjuracoes(combat?.round ?? null, combat?.scene || null);
    if (idos.length) {
      ui.notifications?.info(`Conjuração desfeita: ${idos.join(", ")}.`);
    }
  });
}
