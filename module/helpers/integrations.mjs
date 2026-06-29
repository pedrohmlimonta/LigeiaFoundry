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
 * @param {Actor}   opts.actor          ator que executa a ação (origem)
 * @param {Item}    opts.item           item da ação (config geral / fallback)
 * @param {object}  [opts.action]       a ação (pode ter animação própria)
 * @param {Actor[]} [opts.targetActors] atores-alvo da ação
 *
 * Se a ação tiver animação PRÓPRIA capturada (action.aaConfig) e estiver
 * habilitada, montamos um clone do item com essa config na flag
 * `flags.autoanimations` e entregamos ao módulo — assim cada ação pode ter
 * sua animação independente. Sem isso, usa a animação geral do item.
 */
export async function playAutomatedAnimation({ actor, item, action = null, targetActors = [] } = {}) {
  try {
    if (!isAutomatedAnimationsActive()) return;
    const AA = globalThis.AutomatedAnimations;
    if (!AA || typeof AA.playAnimation !== "function") return;
    if (!item) return;

    const sourceToken = activeTokenOf(actor);
    if (!sourceToken) return; // sem token na cena, não há de onde animar

    const targets = [];
    for (const ta of targetActors) {
      const tk = activeTokenOf(ta);
      if (tk && tk !== sourceToken) targets.push(tk);
    }

    // Decide qual "item" entregar ao módulo: o item real (animação geral) ou
    // um clone carregando a animação própria da ação.
    let aaItem = item;
    const cfg = action?.aaConfig;
    const hasOwn =
      action?.aaEnabled !== false &&
      cfg && typeof cfg === "object" && Object.keys(cfg).length > 0;
    if (hasOwn) {
      try {
        // Clone em memória do item com a flag de animação da ação.
        aaItem = item.clone({ "flags.autoanimations": foundry.utils.deepClone(cfg) }, { keepId: false });
      } catch (e) {
        console.warn("Ligeia | não foi possível montar a animação própria da ação; usando a do item:", e);
        aaItem = item;
      }
    }

    // API do Automated Animations: playAnimation(sourceToken, item, options).
    await AA.playAnimation(sourceToken, aaItem, { targets });
  } catch (e) {
    console.warn("Ligeia | falha ao acionar Automated Animations:", e);
  }
}
