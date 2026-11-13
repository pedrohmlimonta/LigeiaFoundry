/**
 * ENCANTAR ITENS
 * ===========================================================================
 * Um efeito pode, em vez de valer para o personagem, ser gravado num ITEM:
 * é o que chamamos de encantamento. A partir daí ele vale nas AÇÕES daquele
 * item — bônus e penalidades na rolagem, dados de melhoria, crítico,
 * rerrolagem e dano.
 *
 * Vale para os três tipos de efeito do sistema, como todo o resto:
 *   - efeito de um item (marca `enchant` no próprio efeito);
 *   - efeito aplicável por uma ação (`fxEnchant`), que encanta um item do ALVO;
 *   - efeito ativo da ficha (`enchant`), que encanta um item do personagem.
 *
 * O encantamento mora no item encantado (`system.enchantments`), não em quem
 * lançou: assim ele segue o item se ele mudar de dono, e some quando o item
 * some. Cada um guarda de onde veio e quanto ainda dura.
 */

import { resolveEffectValue } from "./effects.mjs";
import { updateItemAsGM } from "./gm-proxy.mjs";

/** Tipos de item que fazem sentido encantar (os que têm ações). */
export const ENCHANTABLE_TYPES = ["equipamento", "habilidade", "magia", "traco", "complicacao"];

/**
 * O item aceita encantamento?
 *
 * Além do tipo, cada item tem a trava "não encantável" na ficha dele
 * (`system.noEnchant`, desmarcada por padrão). Marcada, o item deixa de
 * aparecer na lista de escolha — serve para relíquias, itens de trama e
 * qualquer coisa que o Mestre não queira ver encantada.
 *
 * @param {Item} item
 * @returns {boolean}
 */
export function isEnchantable(item) {
  if (!item || !ENCHANTABLE_TYPES.includes(item.type)) return false;
  return !item.system?.noEnchant;
}

/**
 * Itens de um ator que podem receber encantamento.
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function enchantableItemsOf(actor) {
  return (actor?.items || []).filter((i) => isEnchantable(i));
}

/**
 * Encantamentos que valem AGORA num item (os não desligados).
 * @param {Item} item
 * @returns {Array<object>}
 */
export function activeEnchantmentsOf(item) {
  return (item?.system?.enchantments || []).filter((e) => e && !e.disabled);
}

/**
 * Soma o que os encantamentos de um item somam às ações dele.
 *
 * Devolve só o que faz sentido numa ação: o que entra na rolagem e o que
 * entra no dano. Efeitos de outros tipos (condição, tamanho, recursos) são
 * ignorados aqui — eles não têm onde atuar numa ação de item.
 *
 * @param {Item} item
 * @param {Actor} actor  dono do item, para resolver fórmulas
 * @param {string} attrKey atributo da rolagem (para efeitos mirados nele)
 * @returns {{bonus:number, dice:number, rollDice:number, damage:number,
 *            critBonus:number, failBonus:number, reroll1:number|string,
 *            reroll6:number|string, labels:string[]}}
 */
export function enchantmentMods(item, actor, attrKey = "") {
  const out = {
    bonus: 0, dice: 0, rollDice: 0, damage: 0,
    critBonus: 0, failBonus: 0, reroll1: 0, reroll6: 0, labels: [],
  };
  const lista = activeEnchantmentsOf(item);
  if (!lista.length) return out;

  // Alvos que valem para a rolagem desta ação: o atributo usado, "todas as
  // rolagens" e as categorias de ataque.
  const valeNaRolagem = (alvo) => {
    const a = String(alvo || "all");
    if (a === "all" || a === "attack") return true;
    return !!attrKey && a === attrKey;
  };

  for (const ench of lista) {
    let contou = false;
    for (const e of ench.effects || []) {
      if (!e || e.enabled === false) continue;
      const v = resolveEffectValue(e.value, actor);
      switch (e.type) {
        case "bonus": case "attr":
          if (!valeNaRolagem(e.target)) continue;
          out.bonus += v; break;
        case "dice":
          if (!valeNaRolagem(e.target)) continue;
          out.dice += v; break;
        case "rollDice":
          if (!valeNaRolagem(e.target)) continue;
          out.rollDice += v; break;
        case "crit":
          if (!valeNaRolagem(e.target)) continue;
          out.critBonus += v; break;
        case "fumble":
          if (!valeNaRolagem(e.target)) continue;
          out.failBonus += v; break;
        case "reroll1":
          if (!valeNaRolagem(e.target)) continue;
          out.reroll1 = e.rerollAll ? "all" : (out.reroll1 === "all" ? "all" : (Number(out.reroll1) || 0) + v);
          break;
        case "reroll6":
          if (!valeNaRolagem(e.target)) continue;
          out.reroll6 = e.rerollAll ? "all" : (out.reroll6 === "all" ? "all" : (Number(out.reroll6) || 0) + v);
          break;
        case "damage":
          // Dano somado às parcelas da ação (o alvo aqui é o tipo de dano).
          out.damage += v; break;
        default:
          continue; // tipos sem lugar numa ação de item
      }
      contou = true;
    }
    if (contou) out.labels.push(ench.label || "Encantamento");
  }
  return out;
}

/* ======================================================================== */
/*  Gravar e remover                                                        */
/* ======================================================================== */

/**
 * Grava um encantamento num item.
 * @param {Item} item
 * @param {object} ench {id, label, effects, rounds, source}
 */
export async function applyEnchantment(item, ench) {
  if (!item) return false;
  const lista = foundry.utils.deepClone(item.system?.enchantments || []);
  const rodadas = resolveEffectValue(ench.rounds, item.parent);
  lista.push({
    id: ench.id || foundry.utils.randomID(),
    label: ench.label || "Encantamento",
    effects: foundry.utils.deepClone(ench.effects || []),
    rounds: String(ench.rounds ?? "0"),
    remaining: rodadas,
    source: ench.source || "",
    disabled: false,
  });
  // Encantar o item de OUTRO personagem é comum (um mago abençoa a espada do
  // guerreiro, um inimigo amaldiçoa a arma de quem ataca). Quem conjura
  // raramente é dono da ficha do alvo, então a gravação passa pelo Mestre.
  const res = await updateItemAsGM(item, { "system.enchantments": lista });
  if (!res.ok) {
    console.warn("Ligeia | não foi possível encantar o item:", res);
    if (res.noGM) ui.notifications?.warn("Encantar o item de outro personagem exige um Mestre conectado.");
    else if (res.timeout) ui.notifications?.warn("O Mestre não respondeu ao pedido de encantamento.");
    else ui.notifications?.warn(`Não foi possível encantar ${item.name}.`);
  }
  return res.ok;
}

/**
 * Remove um encantamento de um item, pelo id.
 * @param {Item} item
 * @param {string} id
 */
export async function removeEnchantment(item, id) {
  if (!item || !id) return false;
  const lista = (item.system?.enchantments || []).filter((e) => e.id !== id);
  if (lista.length === (item.system?.enchantments || []).length) return false;
  const res = await updateItemAsGM(item, { "system.enchantments": lista });
  if (!res.ok) console.warn("Ligeia | não foi possível remover o encantamento:", res);
  return res.ok;
}

/**
 * Pergunta qual item encantar. Devolve o Item escolhido, ou null se não há
 * o que escolher ou o usuário desistiu.
 * @param {Actor} actor  dono dos itens
 * @param {string} titulo
 */
export async function pedirItemParaEncantar(actor, titulo = "Encantar um item") {
  const itens = enchantableItemsOf(actor);
  if (!itens.length) {
    // Ou o alvo não carrega nada encantável, ou tudo que ele tem está
    // marcado como não encantável — vale distinguir, senão parece bug.
    const travados = (actor?.items || []).filter(
      (i) => ENCHANTABLE_TYPES.includes(i.type) && i.system?.noEnchant,
    ).length;
    ui.notifications?.warn(travados
      ? `Os itens de ${actor?.name || "o alvo"} estão marcados como não encantáveis.`
      : `${actor?.name || "O alvo"} não tem itens que possam ser encantados.`);
    return null;
  }

  // Agrupa por tipo, com os equipamentos primeiro: é o que se encanta na
  // prática, e numa ficha cheia a lista solta fica difícil de ler.
  const escapar = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
  const rotulos = {
    equipamento: "Equipamentos", magia: "Magias", habilidade: "Habilidades",
    traco: "Traços", complicacao: "Complicações",
  };
  const opcoes = ENCHANTABLE_TYPES.map((tipo) => {
    const doTipo = itens.filter((i) => i.type === tipo);
    if (!doTipo.length) return "";
    const linhas = doTipo.map((i) => {
      const qtd = i.type === "equipamento" && (i.system?.qty ?? 1) > 1 ? ` ×${i.system.qty}` : "";
      const jaTem = (i.system?.enchantments || []).length;
      const nota = jaTem ? ` — já encantado (${jaTem})` : "";
      return `<option value="${i.id}">${escapar(i.name)}${qtd}${nota}</option>`;
    }).join("");
    return `<optgroup label="${rotulos[tipo] || tipo}">${linhas}</optgroup>`;
  }).join("");

  const escolhido = await foundry.applications.api.DialogV2.wait({
    window: { title: titulo },
    content: `<p class="lig-hint">O efeito passa a valer nas ações deste item.</p>
      <label>Item de ${escapar(actor?.name) || "—"}<select name="itemId" style="width:100%">${opcoes}</select></label>`,
    buttons: [
      { action: "ok", label: "Encantar", default: true, callback: (ev, btn) => btn.form.elements.itemId.value },
      { action: "cancel", label: "Cancelar" },
    ],
    rejectClose: false,
  });
  if (!escolhido || escolhido === "cancel") return null;
  return actor.items.get(escolhido) || null;
}

/**
 * Desconta uma rodada dos encantamentos com duração e remove os que
 * acabaram. Chamado no início do turno do dono, junto dos demais efeitos.
 * @param {Actor} actor
 * @returns {Promise<string[]>} rótulos dos que terminaram
 */
export async function tickEnchantmentsAtTurnStart(actor) {
  const terminados = [];
  for (const item of actor?.items || []) {
    const lista = item.system?.enchantments || [];
    if (!lista.length) continue;
    const restantes = [];
    let mudou = false;
    for (const ench of lista) {
      const rodadas = resolveEffectValue(ench.rounds, actor);
      if (rodadas <= 0) { restantes.push(ench); continue; } // 0 = permanente
      const falta = (ench.remaining > 0 ? ench.remaining : rodadas) - 1;
      mudou = true;
      if (falta <= 0) terminados.push(`${ench.label} (${item.name})`);
      else restantes.push({ ...ench, remaining: falta });
    }
    if (mudou) {
      const res = await updateItemAsGM(item, { "system.enchantments": restantes });
      if (!res.ok) console.warn("Ligeia | falha ao descontar encantamento:", res);
    }
  }
  return terminados;
}
