/**
 * SUSTENTAÇÃO — o que custa ação para CONTINUAR de pé
 * ===========================================================================
 * Algumas coisas não acabam quando a ação acaba: a aura zumbindo em volta, a
 * área de fogo no chão, o lobo invocado, a maldição grudada no inimigo, a
 * postura que o guerreiro segura. No Ligeia elas podem ser SUSTENTADAS — e
 * sustentar custa uma ação por rodada.
 *
 * O VÍNCULO
 * ---------
 * Tudo o que é sustentado deixa um EFEITO-VÍNCULO na ficha de quem sustenta.
 * É um efeito comum, que aparece na lista de Efeitos & Condições, não soma
 * modificador nenhum e carrega só uma coisa: o que ele está segurando.
 *
 *   · a cada turno de quem sustenta, o vínculo cobra a ação;
 *   · sem a ação, o vínculo cai — e leva a coisa junto;
 *   · desligar ou remover o vínculo à mão larga a coisa na hora.
 *
 * É por isso que não existe uma aba de "concentração": o que o personagem
 * está segurando está na lista de efeitos dele, e soltar é desligar o efeito.
 *
 * O que um vínculo pode segurar (`sustain.kind`):
 *   item     — o item volta a ficar desligado
 *   template — a área/aura sai do mapa
 *   summon   — os tokens conjurados somem da cena e da iniciativa
 *   effect   — o efeito sai da ficha de quem o recebeu
 *
 * Tudo isto só acontece com a ECONOMIA DE AÇÕES ligada (ver actions.mjs).
 * Sem ela, o que está de pé continua de pé sem cobrar nada de ninguém — mas
 * os vínculos continuam valendo como botão de desfazer.
 */

import { actionEconomyOn, spendActions, actionLabel } from "./actions.mjs";
import { updateActorAsGM } from "./gm-proxy.mjs";

/** Ícone do vínculo na lista de efeitos, por tipo do que ele segura. */
const ICONES = {
  item: "icons/svg/upgrade.svg",
  template: "icons/svg/aura.svg",
  summon: "icons/svg/pawprint.svg",
  effect: "icons/svg/daze.svg",
  none: "icons/svg/aura.svg",
};

/** O efeito é um vínculo de sustentação ativo? */
export function isSustainLink(ae) {
  const s = ae?.sustain;
  return !!(s?.enabled && s.action && s.action !== "none");
}

/** Os vínculos que este personagem está segurando agora. */
export function sustainLinksOf(actor) {
  const out = [];
  (actor?.system?.appliedEffects || []).forEach((ae, index) => {
    if (!isSustainLink(ae) || ae.disabled) return;
    out.push({ ae, index });
  });
  return out;
}

/**
 * Cria o vínculo na ficha de quem sustenta.
 *
 * NADA ACONTECE em dois casos, e os dois são o normal:
 *  · a ação é "none" — a coisa não é sustentável, então não há o que pagar
 *    nem o que largar: ela simplesmente fica, como sempre ficou;
 *  · a economia de ações está desligada — sem ela não existe ação a cobrar,
 *    e encher a lista de efeitos com vínculos que não custam nada só
 *    atrapalharia.
 *
 * Ou seja: vínculo só existe para coisa sustentável, com a economia ligada.
 *
 * @param {Actor} actor  quem sustenta (quem paga)
 * @param {object} p
 * @param {string} p.label   como o vínculo aparece na lista
 * @param {string} p.action  ação cobrada por rodada
 * @param {string} p.kind    o que ele segura (item/template/summon/effect)
 * @param {object} [p.refs]  o necessário para desfazer (ids, uuids…)
 * @param {string} [p.source] de onde veio (item, magia…)
 * @returns {Promise<string>} o fxId do vínculo, ou "" se não criou
 */
export async function createSustainLink(actor, { label, action, kind = "none", refs = {}, source = "" }) {
  if (!actor || !action || action === "none") return "";
  if (!actionEconomyOn()) return "";
  const fxId = foundry.utils.randomID();
  const atual = foundry.utils.deepClone(actor.system?.appliedEffects || []);
  atual.push({
    label: label || "Sustentando",
    icon: ICONES[kind] || ICONES.none,
    // O vínculo não modifica nada: ele só segura.
    effects: [],
    conditionId: "",
    disabled: false,
    duration: { rounds: "0", remaining: 0 }, // dura enquanto for sustentado
    fxId,
    source,
    sustain: {
      enabled: true,
      action,
      byUuid: actor.uuid || "",
      kind,
      itemId: refs.itemId || "",
      sceneId: refs.sceneId || "",
      templateId: refs.templateId || "",
      tokenIds: refs.tokenIds || [],
      actorIds: refs.actorIds || [],
      targets: refs.targets || [],
      targetUuid: refs.targetUuid || "",
      targetFxId: refs.targetFxId || "",
    },
  });
  await updateActorAsGM(actor, { "system.appliedEffects": atual });
  return fxId;
}

/* ======================================================================== */
/*  Desfazer                                                                */
/* ======================================================================== */

/**
 * Desfaz o que um vínculo segurava.
 *
 * Tolerante de propósito: a coisa pode já ter saído por outro caminho (a
 * área expirou, o token foi apagado à mão, o item já estava desligado), e
 * desfazer de novo não pode quebrar nada. Por isso cada passo é tentado em
 * separado e os tropeços só viram aviso no console.
 *
 * @returns {Promise<string>} o que foi desfeito, em palavras (ou "")
 */
export async function undoSustainLink(actor, ae) {
  const s = ae?.sustain;
  if (!s) return "";
  const nome = ae.label || "Sustentação";

  if (s.kind === "item") {
    const item = actor?.items?.get?.(s.itemId);
    if (item?.system?.active && item.isOwner) {
      try { await item.update({ "system.active": false }); }
      catch (e) { console.warn("Ligeia | falha ao desligar o item sustentado:", e); }
    }
    return nome;
  }

  if (s.kind === "template") {
    const cena = globalThis.game?.scenes?.get?.(s.sceneId) || globalThis.canvas?.scene;
    if (cena && s.templateId) {
      try { await cena.deleteEmbeddedDocuments("MeasuredTemplate", [s.templateId]); }
      catch (e) { console.warn("Ligeia | falha ao remover a área sustentada:", e); }
    }
    return nome;
  }

  if (s.kind === "summon") {
    // Tudo de uma vez pelo relé do Mestre: o combatente sai da iniciativa,
    // o token sai do mapa e a ficha própria da criatura é apagada. Um
    // jogador não tem permissão para nada disso, mas o Mestre tem.
    const { dismissSummonAsGM } = await import("./gm-proxy.mjs");
    await dismissSummonAsGM({
      sceneId: s.sceneId,
      tokenIds: s.tokenIds || [],
      actorIds: s.actorIds || [],
    });
    return nome;
  }

  if (s.kind === "effect") {
    // A lista cobre o conjuro que pegou vários; o par solto cobre os
    // vínculos gravados antes de a lista existir.
    const alvos = (s.targets || []).filter((t) => t?.uuid && t?.fxId);
    if (!alvos.length && s.targetUuid && s.targetFxId) {
      alvos.push({ uuid: s.targetUuid, fxId: s.targetFxId });
    }
    // Um alvo pode ter recebido mais de um efeito do mesmo conjuro: junta
    // por ficha para limpar tudo numa atualização só.
    const porFicha = new Map();
    for (const t of alvos) {
      if (!porFicha.has(t.uuid)) porFicha.set(t.uuid, new Set());
      porFicha.get(t.uuid).add(t.fxId);
    }
    for (const [uuid, ids] of porFicha) {
      try {
        const alvo = await fromUuid(uuid);
        if (alvo?.documentName !== "Actor") continue;
        const tinha = alvo.system?.appliedEffects || [];
        const restantes = tinha.filter((x) => !ids.has(x.fxId));
        if (restantes.length !== tinha.length) {
          await updateActorAsGM(alvo, { "system.appliedEffects": restantes });
        }
      } catch (e) {
        console.warn("Ligeia | falha ao tirar o efeito sustentado do alvo:", e);
      }
    }
    return nome;
  }

  return nome;
}

/**
 * Reconcilia os vínculos de uma ficha depois de ela mudar.
 *
 * Compara o antes e o depois: todo vínculo que sumiu da lista ou foi
 * desligado tem o que segurava desfeito. É por aqui que soltar o efeito à
 * mão — o ✕, o botão de ligar/desligar, a expiração por rodadas — larga a
 * área, a criatura ou o item.
 *
 * @param {Actor} actor
 * @param {Array} antes  os vínculos como estavam (de preUpdateActor)
 * @returns {Promise<string[]>} o que foi largado
 */
export async function syncSustainLinks(actor, antes) {
  if (!Array.isArray(antes) || !antes.length) return [];
  const agora = new Map(
    (actor?.system?.appliedEffects || []).filter((ae) => ae.fxId).map((ae) => [ae.fxId, ae]),
  );
  const largados = [];
  for (const ae of antes) {
    if (!isSustainLink(ae) || ae.disabled) continue;
    const atual = agora.get(ae.fxId);
    const saiu = !atual || atual.disabled || !isSustainLink(atual);
    if (!saiu) continue;
    const nome = await undoSustainLink(actor, ae);
    if (nome) largados.push(nome);
  }
  return largados;
}

/** O retrato dos vínculos de uma ficha, para o preUpdateActor guardar. */
export function snapshotSustainLinks(actor) {
  return (actor?.system?.appliedEffects || [])
    .filter((ae) => isSustainLink(ae))
    .map((ae) => foundry.utils.deepClone(ae));
}

/**
 * Tira UMA criatura de um vínculo de conjuração — a que morreu, ou a que
 * saiu do mapa por outro caminho.
 *
 * Os companheiros ficam: morrer um dos três lobos não dispensa os outros
 * dois. Quando o último sai, o vínculo inteiro vai junto, e aí quem
 * sustentava deixa de pagar por uma criatura que não existe mais.
 *
 * @param {Actor} quemSustenta
 * @param {object} saiu  { tokenId, actorId }
 * @returns {Promise<boolean>} se mexeu em algum vínculo
 */
export async function removerDaConjuracao(quemSustenta, { tokenId = "", actorId = "" } = {}) {
  if (!quemSustenta || (!tokenId && !actorId)) return false;
  const lista = quemSustenta.system?.appliedEffects || [];
  let mexeu = false;

  const novos = [];
  for (const ae of lista) {
    const s = ae?.sustain;
    const ehDessa = s?.kind === "summon"
      && ((tokenId && (s.tokenIds || []).includes(tokenId))
        || (actorId && (s.actorIds || []).includes(actorId)));
    if (!ehDessa) { novos.push(ae); continue; }

    const tokens = (s.tokenIds || []).filter((id) => id !== tokenId);
    const fichas = (s.actorIds || []).filter((id) => id !== actorId);
    mexeu = true;
    // Sobrou criatura? O vínculo continua, só que menor.
    if (tokens.length) {
      novos.push({ ...ae, sustain: { ...s, tokenIds: tokens, actorIds: fichas } });
    }
    // Sem nenhuma, o vínculo não é empurrado de volta: ele acabou.
  }
  if (!mexeu) return false;
  await updateActorAsGM(quemSustenta, { "system.appliedEffects": novos });
  return true;
}

/* ======================================================================== */
/*  A cobrança por turno                                                    */
/* ======================================================================== */

/**
 * Cobra, no início do turno, todos os vínculos deste personagem.
 *
 * Cada vínculo é cobrado por si: o que ele conseguir pagar continua, o que
 * não conseguir é largado — o efeito sai da ficha e a coisa se desfaz. Os
 * vínculos são cobrados na ordem em que estão na lista, então numa rodada
 * apertada quem está no topo da lista resiste mais.
 *
 * @returns {Promise<{mantidos:string[], caidos:string[], text:string}>}
 */
export async function sustainTurn(actor, combat = null) {
  const vazio = { mantidos: [], caidos: [], text: "" };
  if (!actionEconomyOn() || !actor) return vazio;

  const links = sustainLinksOf(actor);
  if (!links.length) return vazio;

  const mantidos = [];
  const caidos = [];
  const largar = [];
  for (const { ae } of links) {
    const res = await spendActions(actor, ae.sustain.action, {
      motivo: `sustentar ${ae.label || "o vínculo"}`,
      quiet: true,
    });
    if (res.ok) {
      mantidos.push(`${ae.label || "Sustentação"} <span class="lig-cond-note">(${actionLabel(ae.sustain.action)})</span>`);
    } else {
      caidos.push(ae.label || "Sustentação");
      largar.push(ae);
    }
  }

  // Desfaz primeiro o que cada vínculo segurava e só então tira os vínculos
  // da ficha, numa atualização só — mexer na lista um a um bagunçaria os
  // índices dos seguintes.
  for (const ae of largar) await undoSustainLink(actor, ae);
  if (largar.length) {
    const fora = new Set(largar.map((ae) => ae.fxId));
    const restantes = (actor.system?.appliedEffects || []).filter((ae) => !fora.has(ae.fxId));
    await updateActorAsGM(actor, { "system.appliedEffects": restantes });
  }

  const linhas = [];
  if (mantidos.length) linhas.push(`<div class="lig-sustain-line">Sustentando: ${mantidos.join(", ")}</div>`);
  if (caidos.length) {
    linhas.push(`<div class="lig-sustain-line fell">Desfez-se por falta de ação: <strong>${caidos.join(", ")}</strong></div>`);
  }
  const text = linhas.join("");
  if (text) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="ligeia-roll-flavor">${text}</div>`,
    });
  }
  return { mantidos, caidos, text };
}
