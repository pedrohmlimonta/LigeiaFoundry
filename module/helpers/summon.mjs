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
import { DEATH_HP } from "./wounds.mjs";

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

/**
 * O cardápio de criaturas que a ação oferece (as utilizáveis).
 *
 * Cada entrada vem com `countEff`: a fórmula de quantidade que vale de
 * verdade para ela — o número geral da ação, quando a entrada marca
 * "seguir o geral", ou o número próprio.
 */
export function cardapioDeConjuracao(action) {
  const geral = String(action?.summonCount ?? "1");
  return (action?.summons || [])
    .map((s, index) => ({
      ...s, index,
      countEff: s?.useGlobalCount ? geral : String(s?.count ?? "1"),
    }))
    .filter((s) => s && s.enabled !== false && s.actorUuid);
}

/**
 * A criatura que ESTA ativação vai conjurar.
 *
 * A escolha é na HORA: a caixa aparece depois do clique no botão da ação,
 * não antes. A ação conjura uma criatura por vez, nunca um lobo e um urso
 * juntos — sai só a escolhida, na quantidade fixa que o `count` dela pede.
 *
 * Com uma criatura só no cardápio não há o que perguntar, e ela sai direto.
 *
 * @returns {object|null} a entrada escolhida, ou null (cardápio vazio ou
 *          desistência na caixa)
 */
export async function escolherConjuracao(action, { perguntar = true } = {}) {
  const cardapio = cardapioDeConjuracao(action);
  if (!cardapio.length) return null;
  if (cardapio.length === 1 || !perguntar) return cardapio[0];

  const { pedirCriaturaConjurada } = await import("../apps/roll-dialog.mjs");
  const escolhida = await pedirCriaturaConjurada(cardapio, cardapio[0].index);
  if (escolhida === null) return null; // desistiu
  return cardapio.find((c) => c.index === escolhida) || cardapio[0];
}

/**
 * A ação conjura alguma coisa? (sem perguntar nada — é só a conferência
 * que o motor faz antes de abrir qualquer caixa)
 */
export function conjuracoesDaAcao(action) {
  return cardapioDeConjuracao(action);
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
  if (!cardapioDeConjuracao(action).length) return "";

  const cena = globalThis.canvas?.scene;
  if (!cena) {
    return '<div class="lig-summon-line muted">Conjuração: nenhuma cena aberta para colocar a criatura.</div>';
  }

  // UMA criatura por ativação — a marcada, ou a que for escolhida na hora.
  const escolhida = await escolherConjuracao(action, { perguntar: !!actor?.isOwner });
  if (!escolhida) {
    return '<div class="lig-summon-line muted">Conjuração cancelada.</div>';
  }
  const lista = [escolhida];

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

    // A quantidade vem do número geral ou do próprio, conforme a entrada.
    const quantas = Math.max(1, Math.round(resolveEffectValue(conj.countEff ?? conj.count, actor, { gasto }) || 1));
    const duracao = Math.max(0, Math.round(resolveEffectValue(conj.rounds, actor, { gasto })));
    let feitas = 0;
    // Tokens (e as fichas próprias deles) desta criatura, para o vínculo
    // de sustentação saber o que dispensar quando a ação faltar.
    const tokensFeitos = [];
    const fichasFeitas = [];
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
        // Cada cópia ganha a própria ficha (salvo se a entrada disser que
        // não), para duas criaturas iguais não dividirem PV no combate.
        ownSheet: conj.ownSheet !== false,
        ordem: n,
        summonFlag: {
          summonerUuid: actor?.uuid || "",
          itemName: item?.name || "",
          actionLabel: action?.label || "",
          rounds: duracao,
          createdRound: rodadaAtual,
          remaining: duracao,
        },
      });
      if (res?.ok) {
        feitas++;
        if (res.tokenId) tokensFeitos.push(res.tokenId);
        if (res.actorId) fichasFeitas.push(res.actorId);
      }
      else if (res?.noGM) { avisos.push(`${ficha.name} (nenhum Mestre conectado)`); break; }
      else if (res?.timeout) { avisos.push(`${ficha.name} (o Mestre não respondeu)`); break; }
      else { avisos.push(`${ficha.name} (${res?.error || "falhou"})`); break; }
    }

    if (feitas) {
      const quanto = feitas > 1 ? `${feitas}× ` : "";
      const quanto2 = duracao > 0 ? ` por ${duracao} rodada${duracao > 1 ? "s" : ""}` : "";
      // CONJURAÇÃO SUSTENTADA: a criatura só fica em campo enquanto quem a
      // chamou pagar a ação. O vínculo na ficha é quem cobra — e soltá-lo
      // manda a criatura embora, da cena e da iniciativa.
      let sustentada = "";
      if (conj.sustain && conj.sustain !== "none" && tokensFeitos.length) {
        const { createSustainLink } = await import("./sustain.mjs");
        await createSustainLink(actor, {
          label: `Sustentando: ${ficha.name}${feitas > 1 ? ` ×${feitas}` : ""}`,
          action: conj.sustain,
          kind: "summon",
          refs: { sceneId: cena.id, tokenIds: tokensFeitos, actorIds: fichasFeitas },
          source: item?.name || "",
        });
        sustentada = " <span class=\"lig-cond-note\">(sustentada)</span>";
      }
      postas.push(`${quanto}<strong>${ficha.name}</strong>${quanto2}${sustentada}`);
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

/** A marca de FICHA CONJURADA de uma ficha (ou null). */
export function fichaConjurada(actor) {
  const lig = actor?.getFlag?.("ligeia-rpg", "summoned") ?? actor?.flags?.["ligeia-rpg"]?.summoned;
  return lig || null;
}

/**
 * A criatura conjurada morreu?
 * Vale o mesmo limiar de morte do resto do sistema (ver wounds.mjs).
 */
export function conjuradaMorreu(actor) {
  if (!fichaConjurada(actor)) return false;
  return (Number(actor?.system?.resources?.hp?.value) ?? 0) <= DEATH_HP;
}

/**
 * Dispensa uma criatura conjurada que saiu de cena por conta própria —
 * morreu, ou o token foi apagado à mão.
 *
 * Tira o que sobrou (token, combatente, ficha) e avisa quem a sustentava,
 * para o vínculo encolher — ou acabar, se era a última.
 */
export async function dispensarConjurada(actor, { tokenId = "", sceneId = "" } = {}) {
  const marca = fichaConjurada(actor);
  if (!marca) return false;

  const { dismissSummonAsGM } = await import("./gm-proxy.mjs");
  await dismissSummonAsGM({
    sceneId: sceneId || globalThis.canvas?.scene?.id || "",
    tokenIds: tokenId ? [tokenId] : [],
    actorIds: actor?.id ? [actor.id] : [],
  });

  // Quem a sustentava para de pagar por ela.
  try {
    const quem = marca.summonerUuid ? await fromUuid(marca.summonerUuid) : null;
    if (quem?.documentName === "Actor") {
      const { removerDaConjuracao } = await import("./sustain.mjs");
      await removerDaConjuracao(quem, { tokenId, actorId: actor.id });
    }
  } catch (e) {
    console.warn("Ligeia | falha ao avisar quem sustentava a criatura:", e);
  }
  return true;
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

  // MORREU: a criatura conjurada some do campo, e a ficha dela vai junto.
  // Quem processa é um Mestre só, para a ficha não ser apagada em duplicata.
  Hooks.on("updateActor", async (actor, changes) => {
    if (!mestreResponsavel()) return;
    if (!foundry.utils.hasProperty(changes, "system.resources.hp.value")) return;
    if (!conjuradaMorreu(actor)) return;
    const token = actor.getActiveTokens?.(true)?.[0] || actor.getActiveTokens?.()?.[0];
    const nome = actor.name;
    const foi = await dispensarConjurada(actor, {
      tokenId: token?.document?.id || token?.id || "",
      sceneId: token?.document?.parent?.id || globalThis.canvas?.scene?.id || "",
    });
    if (foi) ui.notifications?.info(`${nome} caiu e a conjuração se desfez.`);
  });

  // TOKEN APAGADO à mão: a ficha que nasceu com ele não fica para trás.
  Hooks.on("deleteToken", async (tokenDoc) => {
    if (!mestreResponsavel()) return;
    const actor = tokenDoc?.actor;
    if (!fichaConjurada(actor)) return;
    // O token já saiu; resta a ficha e o aviso a quem sustentava.
    await dispensarConjurada(actor, { tokenId: tokenDoc.id, sceneId: tokenDoc.parent?.id || "" });
  });
}
