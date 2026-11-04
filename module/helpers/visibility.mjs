/**
 * QUEM PODE VER O QUÊ
 * ===========================================================================
 * Regra única de visibilidade dos recursos de um ator (PV/PM/PH), usada tanto
 * pelas barras desenhadas abaixo do token quanto pelas mensagens de chat.
 *
 * Fica num módulo próprio, sem nenhuma dependência, porque os dois lados que a
 * usam já dependem um do outro por outros caminhos — importar daqui evita um
 * ciclo entre helpers.
 */

/** Tipos de ator deste sistema. */
export const ACTOR_TYPES = ["personagem", "npc", "veiculo"];

/** Tipos cujos recursos ficam escondidos dos jogadores até o Narrador liberar. */
export const GM_ONLY_TYPES = ["npc", "veiculo"];

/**
 * O usuário atual pode ver as barras de recurso deste ator?
 *  - Narrador: tudo.
 *  - Dono do ator: o próprio personagem.
 *  - Demais: personagens do grupo sim; NPCs e veículos só quando o Narrador
 *    marca "barras visíveis aos jogadores" naquele ator.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function barsVisibleFor(actor) {
  if (!actor) return false;
  if (!ACTOR_TYPES.includes(actor.type)) return false;
  if (game.user?.isGM) return true;
  if (actor.isOwner) return true;
  if (GM_ONLY_TYPES.includes(actor.type)) {
    return !!actor.system?.tokenBars?.players;
  }
  return true;
}

/**
 * O usuário atual pode ver os NÚMEROS de um recurso deste ator (no chat ou na
 * barra)? Vale a visibilidade acima E a caixinha daquela barra na ficha: uma
 * barra desligada esconde o número também do chat.
 * @param {Actor} actor
 * @param {string} [resource] "hp" | "mp" | "heroic"
 * @returns {boolean}
 */
export function resourceVisibleFor(actor, resource = "hp") {
  if (!actor) return false;
  if (game.user?.isGM) return true;
  if (actor.isOwner) return true;
  if (!barsVisibleFor(actor)) return false;
  const bars = actor.system?.tokenBars || {};
  const key = resource === "mp" ? "mp" : (resource === "heroic" ? "heroic" : "hp");
  return bars[key] !== false;
}
