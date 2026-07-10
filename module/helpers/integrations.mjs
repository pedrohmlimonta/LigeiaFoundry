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

/** O módulo Sequencer está instalado e ativo? */
export function isSequencerActive() {
  return !!game.modules.get("sequencer")?.active && !!globalThis.Sequence;
}

/** Abre o visualizador da base de efeitos do Sequencer (para procurar caminhos). */
export function openSequencerDatabase() {
  try {
    if (globalThis.Sequencer?.DatabaseViewer?.show) {
      globalThis.Sequencer.DatabaseViewer.show();
    } else {
      ui.notifications?.warn("Sequencer não está disponível para abrir a base de efeitos.");
    }
  } catch (e) {
    console.warn("Ligeia | erro ao abrir a base do Sequencer:", e);
  }
}

/**
 * Toca a animação PRÓPRIA de uma ação via Sequencer, de forma independente
 * das outras ações do mesmo item.
 *
 * @returns {boolean} true se tocou (ou tentou tocar) algo; false se não havia
 *   animação configurada ou o Sequencer não está disponível (para permitir
 *   fallback para a animação geral do item via Automated Animations).
 */
export function playSequencerAnimation({ actor, action, targetActors = [], attach = false } = {}) {
  try {
    if (!action) return false;
    const file = (action.animFile || "").trim();
    if (!file || action.animEnabled === false) return false;
    if (!isSequencerActive()) {
      ui.notifications?.warn("Esta ação tem animação, mas o módulo Sequencer não está ativo.");
      return false;
    }
    const sourceToken = activeTokenOf(actor);
    if (!sourceToken) return false;

    const targets = [];
    for (const ta of targetActors) {
      const tk = activeTokenOf(ta);
      if (tk && tk !== sourceToken) targets.push(tk);
    }

    const placement = action.animPlacement || "target";
    const scale = Number(action.animScale) || 1;
    // Prende o efeito ao token (acompanha o movimento) quando pedido pela ação
    // ou quando a ação move tokens.
    const doAttach = !!attach || !!action.animAttach;
    const seq = new globalThis.Sequence();

    /** Ancora o efeito num token: preso (segue) ou fixo na posição atual. */
    const anchor = (fx, token) => {
      if (doAttach && typeof fx.attachTo === "function") {
        try { return fx.attachTo(token); }
        catch (e) { console.warn("Ligeia | attachTo indisponível; usando atLocation:", e); }
      }
      return fx.atLocation(token);
    };

    if (placement === "cast" || targets.length === 0) {
      // No conjurador (ou sem alvos, toca na origem).
      anchor(seq.effect().file(file), sourceToken).scale(scale);
    } else if (placement === "ranged") {
      // Projétil do conjurador até cada alvo. Preso, as duas pontas seguem.
      for (const t of targets) {
        const fx = anchor(seq.effect().file(file), sourceToken);
        try {
          fx.stretchTo(t, doAttach ? { attachTo: true } : {}).scale(scale);
        } catch (e) {
          fx.stretchTo(t).scale(scale);
        }
      }
    } else {
      // "target": toca sobre cada alvo.
      for (const t of targets) {
        anchor(seq.effect().file(file), t).scale(scale);
      }
    }
    seq.play();
    return true;
  } catch (e) {
    console.warn("Ligeia | falha ao tocar animação (Sequencer):", e);
    return false;
  }
}

/**
 * Dispara a animação de uma ação. Prioriza a animação PRÓPRIA da ação (via
 * Sequencer); se a ação não tiver uma, cai para a animação geral do item via
 * Automated Animations.
 */
export async function playActionAnimation({ actor, item, action = null, targetActors = [], attach = false } = {}) {
  // 1) Animação PUXADA do item para a ação (cópia visual, sem digitar).
  //    O Automated Animations controla ele mesmo se o efeito segue o token
  //    (opção de "attach" na configuração dele) — aqui só controlamos QUANDO.
  const cfg = action?.aaConfig;
  const hasPulled =
    action?.aaEnabled !== false &&
    cfg && typeof cfg === "object" && Object.keys(cfg).length > 0;
  if (hasPulled) {
    await playAutomatedAnimation({ actor, item, action, targetActors });
    return;
  }
  // 2) Animação própria da ação por caminho (Sequencer, avançado).
  const played = playSequencerAnimation({ actor, action, targetActors, attach });
  if (played) return;
  // 3) Fallback: animação geral do item (Automated Animations).
  await playAutomatedAnimation({ actor, item, action: null, targetActors });
}

/**
 * Dispara a animação geral do item via Automated Animations. Se a ação tiver
 * animação própria capturada (legado, action.aaConfig) e habilitada, monta um
 * clone do item com essa config na flag `flags.autoanimations`. Sem isso, usa
 * a animação configurada no próprio item.
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
