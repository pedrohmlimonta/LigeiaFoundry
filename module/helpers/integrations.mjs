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
import { resolveEffectValue } from "./effects.mjs";

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
    const scale = resolveEffectValue(action.animScale, actor) || 1;
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

/* ==================================================================== */
/*  EFEITOS VISUAIS PERSISTENTES (enquanto o efeito/habilidade durar)    */
/* ==================================================================== */

/** Nome único do efeito visual de um efeito aplicado / item ativo. */
export function persistentFxName(chave) {
  return `ligeia-fx-${chave}`;
}

/**
 * Toca um efeito visual PRESO ao token e que PERMANECE até ser encerrado
 * (usado por efeitos ativos e habilidades ligadas).
 * @returns {boolean} true se começou a tocar
 */
export function playPersistentFx({ actor, file, scale = 1, name } = {}) {
  try {
    const caminho = (file || "").trim();
    if (!caminho || !name) return false;
    if (!isSequencerActive()) return false;
    const token = activeTokenOf(actor);
    if (!token) return false;
    // Evita duplicar se já houver um efeito com este nome.
    endPersistentFx(name);
    const seq = new globalThis.Sequence();
    const fx = seq.effect().file(caminho).scale(Number(scale) || 1);
    try { fx.attachTo(token); } catch (e) { fx.atLocation(token); }
    fx.persist().name(name);
    seq.play();
    return true;
  } catch (e) {
    console.warn("Ligeia | falha ao tocar efeito visual persistente:", e);
    return false;
  }
}

/** Encerra um efeito visual persistente pelo nome. */
export function endPersistentFx(name) {
  try {
    if (!name) return;
    globalThis.Sequencer?.EffectManager?.endEffects?.({ name });
  } catch (e) {
    console.warn("Ligeia | falha ao encerrar efeito visual persistente:", e);
  }
}

/* ==================================================================== */
/*  ANIMAÇÃO DE EFEITO (puxada do item, presa ao portador)               */
/* ==================================================================== */

/**
 * Extrai de uma config do Automated Animations o caminho que o Sequencer
 * entende, para podermos tocá-la nós mesmos — e assim controlar quando ela
 * começa e quando acaba (o AA só oferece disparo avulso).
 *
 * A config guarda a escolha em `primary.video` como
 * {dbSection, menuType, animation, variant, color} ou um `customPath`; o
 * caminho da base é "autoanimations.<seção>.<tipo>.<animação>.<variante>[.<cor>]".
 *
 * @param {object} cfg conteúdo de flags.autoanimations
 * @returns {string} caminho, ou "" se não der para montar
 */
export function aaConfigFilePath(cfg) {
  try {
    const v = cfg?.primary?.video || cfg?.data?.video || {};
    if (v.enableCustom && v.customPath) return String(v.customPath).trim();
    const { dbSection, menuType, animation, variant, color } = v;
    if (!dbSection || !menuType || !animation || !variant) return "";
    const base = `autoanimations.${dbSection}.${menuType}.${animation}.${variant}`;
    const comCor = color && color !== "random" ? `${base}.${color}` : base;
    // Se o Sequencer estiver presente, confirma que a entrada existe; sem ele,
    // devolve o caminho mesmo assim (quem toca decide o que fazer).
    const db = globalThis.Sequencer?.Database;
    if (db?.getEntry) {
      if (db.getEntry(comCor, { softFail: true })) return comCor;
      if (db.getEntry(base, { softFail: true })) return base;
      return "";
    }
    return comCor;
  } catch (e) {
    return "";
  }
}

/** Escala guardada na config do Automated Animations (1 se não houver). */
export function aaConfigScale(cfg) {
  const n = Number(cfg?.primary?.options?.size ?? cfg?.data?.options?.size);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Toca o visual de um EFEITO (de item, aplicado por ação ou ativo na ficha),
 * preso ao token do portador e permanecendo até `endPersistentFx(name)`.
 *
 * Fontes, em ordem:
 *  1. animação PUXADA do item (fxAaConfig) — tocada pelo Sequencer a partir do
 *     caminho extraído, para que dure exatamente enquanto o efeito durar;
 *  2. caminho digitado à mão (fxFile);
 *  3. se a config foi puxada mas o caminho não pôde ser extraído, dispara o
 *     Automated Animations uma vez, com o portador como conjurador E alvo —
 *     some sozinha, mas é melhor do que nada.
 *
 * @param {object} p
 * @param {Actor}  p.actor    portador do efeito
 * @param {object} p.fx       o efeito ({fxFile, fxScale, fxAaConfig})
 * @param {string} p.name     nome do visual persistente (para encerrar depois)
 * @param {Item}   [p.item]   item de origem, usado no caminho 3
 * @returns {Promise<boolean>} true se algo começou a tocar de forma persistente
 */
export async function playEffectFx({ actor, fx, name, item = null } = {}) {
  if (!actor || !fx || !name) return false;
  const cfg = fx.fxAaConfig;
  const temCfg = cfg && typeof cfg === "object" && Object.keys(cfg).length > 0;

  if (temCfg) {
    const caminho = aaConfigFilePath(cfg);
    if (caminho) {
      const escala = fx.fxScale && String(fx.fxScale).trim() && String(fx.fxScale) !== "1"
        ? fx.fxScale
        : aaConfigScale(cfg);
      return playPersistentFx({ actor, file: caminho, scale: escala, name });
    }
  }

  if (fx.fxFile) {
    return playPersistentFx({ actor, file: fx.fxFile, scale: fx.fxScale, name });
  }

  if (temCfg) {
    // Último recurso: o portador faz os dois papéis (conjurador e alvo).
    const fonte = item || null;
    if (fonte) {
      await playAutomatedAnimation({
        actor, item: fonte,
        action: { aaConfig: cfg, aaEnabled: true },
        targetActors: [actor], allowSelfTarget: true,
      });
    }
  }
  return false;
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
export async function playAutomatedAnimation({ actor, item, action = null, targetActors = [], allowSelfTarget = false } = {}) {
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
      // Normalmente o conjurador não é alvo de si mesmo; nos EFEITOS ele é,
      // porque quem carrega o efeito faz os dois papéis.
      if (tk && (allowSelfTarget || tk !== sourceToken)) targets.push(tk);
    }

    // Decide qual "item" entregar ao módulo: o item real (animação geral) ou
    // um clone carregando a animação própria da ação.
    let aaItem = item;
    const cfg = action?.aaConfig;
    const hasOwn =
      action?.aaEnabled !== false &&
      cfg && typeof cfg === "object" && Object.keys(cfg).length > 0;
    if (hasOwn) {
      // Config puxada IGUAL à do item (o caso normal): entrega o item REAL.
      // Um clone pode perder partes da configuração — como as animações
      // secundária e no alvo —, então só clonamos quando é imprescindível.
      const atual = item.flags?.autoanimations ?? null;
      const mesma = JSON.stringify(cfg) === JSON.stringify(atual);
      if (!mesma) {
        try {
          // Item temporário com a config EXATA que foi puxada (substitui a
          // flag inteira, em vez de mesclar com a atual do item).
          const dados = item.toObject();
          dados.flags = { ...(dados.flags || {}), autoanimations: foundry.utils.deepClone(cfg) };
          aaItem = new item.constructor(dados, { parent: item.parent });
        } catch (e) {
          console.warn("Ligeia | não foi possível montar a animação própria da ação; usando a do item:", e);
          aaItem = item;
        }
      }
    }

    // API do Automated Animations: playAnimation(sourceToken, item, options).
    await AA.playAnimation(sourceToken, aaItem, { targets });
  } catch (e) {
    console.warn("Ligeia | falha ao acionar Automated Animations:", e);
  }
}
