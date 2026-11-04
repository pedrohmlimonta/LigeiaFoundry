/**
 * PRIVACIDADE DOS RECURSOS NO CHAT
 * ===========================================================================
 * As mensagens de dano, cura e regeneração mostram quanto o alvo ficou de
 * PV/PM/PH. Isso é útil na mesa, mas entrega a vida dos NPCs para os
 * jogadores — justamente o que as barras de token deixam o Narrador esconder.
 *
 * A mensagem de chat é uma só para todo mundo, então a filtragem acontece na
 * HORA DE EXIBIR, em cada cliente: quem escreve a mensagem embrulha a parte
 * numérica com `privateResource()`, e o hook de render apaga esse trecho para
 * quem não tem direito de ver aquele ator.
 *
 * QUEM VÊ
 *   - Narrador: tudo.
 *   - Dono do ator: o próprio personagem.
 *   - Demais: segue a barra de PV daquele ator no mapa (ver token-bars.mjs) —
 *     personagens do grupo sim; NPCs e veículos só com "barras visíveis aos
 *     jogadores" marcado, e só enquanto a barra do recurso estiver ligada.
 *
 * O DANO CONTINUA APARECENDO: some apenas o "PV: 3/12" do alvo, nunca o
 * número de dano causado, que é o que a mesa precisa saber.
 */

import { resourceVisibleFor, GM_ONLY_TYPES } from "./visibility.mjs";

/** Classe do trecho que pode ser escondido. */
const MARK = "lig-private-res";
/** Blocos que ficam vazios quando o trecho é removido e devem sumir junto. */
const WRAPPERS = ".lig-dmg-applied, .lig-heal-applied";

// A regra de quem vê o quê mora em visibility.mjs e é a MESMA das barras.
export { resourceVisibleFor };

/**
 * Embrulha um trecho de HTML que revela o estado de um recurso do alvo.
 * O trecho é apagado no cliente de quem não puder vê-lo.
 * @param {Actor} actor    dono do recurso
 * @param {string} html    conteúdo (já montado) a proteger
 * @param {string} [resource] "hp" | "mp" | "heroic"
 * @returns {string}
 */
export function privateResource(actor, html, resource = "hp") {
  if (!html) return "";
  const uuid = actor?.uuid || "";
  // `npc` serve de rede de segurança: se o ator não puder ser resolvido na
  // hora de exibir (cena descarregada, token apagado), o trecho some em vez
  // de vazar.
  const ehNpc = GM_ONLY_TYPES.includes(actor?.type) ? "1" : "0";
  return `<span class="${MARK}" data-lig-actor="${uuid}" data-lig-npc="${ehNpc}" data-lig-res="${resource}">${html}</span>`;
}

/**
 * Decide, no cliente, se um trecho marcado deve continuar visível.
 * @param {HTMLElement} el
 */
function podeVer(el) {
  if (game.user?.isGM) return true;
  const uuid = el.dataset.ligActor || "";
  let actor = null;
  try {
    const doc = uuid ? fromUuidSync(uuid) : null;
    actor = doc?.actor ?? doc ?? null;
  } catch (e) {
    actor = null;
  }
  // Não deu para resolver: esconde se era de um NPC, mostra se era de um
  // personagem (o comportamento de antes, para não sumir informação do grupo).
  if (!actor) return el.dataset.ligNpc !== "1";
  return resourceVisibleFor(actor, el.dataset.ligRes || "hp");
}

/**
 * Aplica o filtro ao HTML de uma mensagem já renderizada.
 * @param {HTMLElement} root
 */
export function filterChatMessage(root) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll(`.${MARK}`)) {
    if (podeVer(el)) continue;
    const pai = el.closest(WRAPPERS);
    el.remove();
    // Se o bloco existia só para mostrar o recurso, some com ele também —
    // senão fica uma linha vazia na mensagem.
    if (pai && !pai.textContent.trim() && !pai.querySelector("img, i")) pai.remove();
  }
}

/** Liga o filtro à renderização das mensagens de chat. */
export function registerChatPrivacyHooks() {
  // V13+ entrega um HTMLElement.
  Hooks.on("renderChatMessageHTML", (_msg, html) => {
    filterChatMessage(html instanceof HTMLElement ? html : html?.[0]);
  });
  // Compatibilidade com o hook antigo (jQuery).
  Hooks.on("renderChatMessage", (_msg, html) => {
    filterChatMessage(html instanceof HTMLElement ? html : html?.[0]);
  });
}
