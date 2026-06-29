/**
 * Integrações com módulos externos.
 *
 * Automated Animations (módulo "autoanimations"): dispara a animação
 * configurada para o item quando uma ação é executada. O módulo só reproduz
 * algo se o item estiver configurado no menu do Automated Animations (por
 * nome do item ou pela própria janela de configuração), então chamar a API
 * de forma incondicional é seguro — itens sem configuração simplesmente não
 * animam.
 */

/** O módulo Automated Animations está instalado e ativo? */
export function isAutomatedAnimationsActive() {
  return !!game.modules.get("autoanimations")?.active;
}

/** Pega o token (placeable) ativo de um ator na cena atual, se houver. */
function activeTokenOf(actor) {
  if (!actor?.getActiveTokens) return null;
  return actor.getActiveTokens(true)?.[0] || actor.getActiveTokens()?.[0] || null;
}

/**
 * Dispara a animação do Automated Animations para uma ação.
 *
 * @param {object}  opts
 * @param {Actor}   opts.actor         ator que executa a ação (origem)
 * @param {Item}    opts.item          item da ação (usado para achar a config)
 * @param {Actor[]} [opts.targetActors] atores-alvo da ação
 *
 * É tolerante a falhas: se o módulo não estiver presente, a API divergir ou
 * algo falhar, apenas registra um aviso e segue (a ação acontece normalmente).
 */
export async function playAutomatedAnimation({ actor, item, targetActors = [] } = {}) {
  try {
    if (!isAutomatedAnimationsActive()) return;
    const AA = globalThis.AutomatedAnimations;
    if (!AA || typeof AA.playAnimation !== "function") return;
    if (!item) return;

    const sourceToken = activeTokenOf(actor);
    if (!sourceToken) return; // sem token na cena, não há de onde animar

    // Converte os atores-alvo nos seus tokens na cena (o módulo trabalha com
    // tokens). Ignora alvos sem token visível.
    const targets = [];
    for (const ta of targetActors) {
      const tk = activeTokenOf(ta);
      if (tk && tk !== sourceToken) targets.push(tk);
    }

    // API do Automated Animations: playAnimation(sourceToken, item, options).
    // Passamos os alvos explicitamente; o módulo também lê game.user.targets,
    // que já marcamos no fluxo de área/aura.
    await AA.playAnimation(sourceToken, item, { targets });
  } catch (e) {
    console.warn("Ligeia | falha ao acionar Automated Animations:", e);
  }
}
