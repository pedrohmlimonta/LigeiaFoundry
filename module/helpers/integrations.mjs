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
 * Liga a persistência em todos os ramos de uma config do Automated Animations.
 * O menu "Active Effects" do AA tem a opção "Persistent"; forçando-a aqui, uma
 * animação puxada vale como visual contínuo mesmo que o usuário não a tenha
 * marcado — e nós é que decidimos quando ela acaba.
 */
function forcarPersistencia(cfg) {
  const copia = foundry.utils.deepClone(cfg);
  for (const ramo of ["primary", "source", "target", "secondary", "data"]) {
    const r = copia?.[ramo];
    if (r && typeof r === "object") {
      r.options = r.options || {};
      r.options.persistent = true;
    }
  }
  return copia;
}

/**
 * Toca a animação PUXADA pelo próprio Automated Animations, para que venha
 * com tudo o que foi configurado nele (cor, tamanho, opacidade, secundária,
 * no alvo), e a prende a um "origin" que nós escolhemos — é por ele que a
 * encerramos quando o efeito sair.
 *
 * O AA grava `origin: item.uuid` em toda animação persistente. Entregamos a
 * ele um item temporário cujo uuid É o nome do nosso efeito, de modo que
 * `endEffectFx(nome)` consiga encerrar exatamente esta animação.
 *
 * @returns {Promise<boolean>} true se a animação foi disparada
 */
/**
 * De que `origin` o Automated Animations marcou cada visual de efeito que
 * começamos. O AA grava `origin: item.uuid` nas animações persistentes; como
 * às vezes entregamos o item REAL (para a animação vir perfeita) e às vezes um
 * temporário, guardamos aqui qual foi, para encerrar a certa depois.
 */
const origemPorNome = new Map();

/**
 * Toca a animação PUXADA pelo próprio Automated Animations — exatamente pelo
 * mesmo caminho das ações, que é o que faz a animação vir completa (cor,
 * tamanho, opacidade, secundária e no alvo).
 *
 * A única diferença para uma ação é que aqui o portador do efeito é o
 * conjurador E o alvo (allowSelfTarget), e que forçamos a persistência quando
 * precisamos montar um item temporário de qualquer jeito.
 *
 * @returns {Promise<boolean>} true se a animação foi disparada
 */
async function playAaEffect({ actor, cfg, name, item = null, persistir = true }) {
  try {
    if (!isAutomatedAnimationsActive()) return false;
    const token = activeTokenOf(actor);
    if (!token) return false;

    const atual = item?.flags?.autoanimations ?? null;
    const mesma = !!item && JSON.stringify(cfg) === JSON.stringify(atual);

    // Quando o visual tem de PERMANECER, sempre montamos um item temporário
    // cujo uuid é o nome do efeito. Isso serve a duas coisas: liga a
    // persistência mesmo que ela não esteja marcada no menu do Automated
    // Animations, e — principalmente — faz o AA gravar um `origin` que
    // QUALQUER cliente consegue recalcular na hora de encerrar. Usar o item
    // real aqui deixaria o origin dependendo do uuid dele, que o efeito
    // aplicado não carrega, e a animação ficaria presa na tela.
    if (mesma && !persistir) {
      // Caminho IDÊNTICO ao das ações: entrega o item REAL. É o que preserva
      // a configuração inteira — um clone pode perder partes dela.
      origemPorNome.set(name, item.uuid);
      await playAutomatedAnimation({
        actor, item, action: null, targetActors: [actor], allowSelfTarget: true,
      });
      return true;
    }

    // A config puxada já não é a do item (ou não há item): monta um
    // temporário com ela, como a ação faz, e aproveita para ligar a
    // persistência e fixar o `origin` pelo qual vamos encerrar.
    const base = item?.toObject?.() ?? { name: "Efeito", type: "traco" };
    const cfgFinal = persistir ? forcarPersistencia(cfg) : foundry.utils.deepClone(cfg);
    base.flags = { ...(base.flags || {}), autoanimations: cfgFinal };
    const Classe = item?.constructor ?? CONFIG?.Item?.documentClass;
    if (!Classe) return false;
    const temp = new Classe(base, { parent: actor });
    try {
      Object.defineProperty(temp, "uuid", { value: name, configurable: true });
      origemPorNome.set(name, name);
    } catch (e) {
      origemPorNome.set(name, temp.uuid);
    }

    const AA = globalThis.AutomatedAnimations;
    if (!AA?.playAnimation) return false;
    await AA.playAnimation(token, temp, { targets: [token] });
    return true;
  } catch (e) {
    console.warn("Ligeia | falha ao tocar a animação puxada do efeito:", e);
    return false;
  }
}

/**
 * Toca o visual de um EFEITO (de item, aplicado por ação ou ativo na ficha).
 * Ele permanece até `endEffectFx(name)`.
 *
 * Fontes, em ordem:
 *  1. animação PUXADA do item (fxAaConfig) — tocada pelo próprio Automated
 *     Animations, com todas as configurações dele, e com a persistência
 *     forçada para durar o que o efeito durar;
 *  2. caminho digitado à mão (fxFile) — tocado direto pelo Sequencer.
 *
 * @param {object} p
 * @param {Actor}  p.actor  portador do efeito
 * @param {object} p.fx     o efeito ({fxFile, fxScale, fxAaConfig})
 * @param {string} p.name   nome do visual (para encerrar depois)
 * @param {Item}   [p.item] item de origem, quando houver
 * @returns {Promise<boolean>} true se algo começou a tocar
 */
export async function playEffectFx({ actor, fx, name, item = null } = {}) {
  if (!actor || !fx || !name) return false;
  const cfg = fx.fxAaConfig;
  const temCfg = cfg && typeof cfg === "object" && Object.keys(cfg).length > 0;

  if (temCfg) {
    // A caixinha "manter enquanto durar" decide se forçamos a permanência.
    const persistir = fx.fxAaPersist !== false;
    const tocou = await playAaEffect({ actor, cfg, name, item, persistir });
    if (tocou) return true;
  }
  if (fx.fxFile) {
    return playPersistentFx({ actor, file: fx.fxFile, scale: fx.fxScale, name });
  }
  return false;
}

/**
 * Encerra o visual de um efeito, qualquer que tenha sido a fonte: o nome cobre
 * o que tocamos pelo Sequencer, e o origin cobre o que o Automated Animations
 * tocou por nossa conta.
 */
export function endEffectFx(name) {
  if (!name) return;
  endPersistentFx(name);
  const fim = globalThis.Sequencer?.EffectManager?.endEffects;
  if (!fim) return;
  const origens = new Set([name]);
  const registrada = origemPorNome.get(name);
  if (registrada) origens.add(registrada);
  for (const origin of origens) {
    try { fim({ origin }); } catch (e) {
      console.warn("Ligeia | falha ao encerrar a animação do efeito:", e);
    }
  }
  origemPorNome.delete(name);
}

/**
 * Nome que o Automated Animations dá aos visuais que ele põe num token
 * quando chamado pela API: "spot <id do token>". Ele é o MESMO para todos os
 * efeitos daquele token — não dá para encerrar um sem encerrar os outros.
 */
function nomeAaDoToken(token) {
  return token?.id ? `spot ${token.id}` : "";
}

/**
 * Derruba TODOS os visuais do Automated Animations que estejam neste token
 * por nossa conta. Como o AA usa um nome só por token, esta é a única forma
 * de garantir que o visual de um efeito encerrado saia da tela.
 *
 * Quem chama precisa reacender depois o que continua valendo — é o que
 * `resyncEffectFx` faz.
 * @param {Token} token
 */
export function endAllAaFxOnToken(token) {
  const EM = globalThis.Sequencer?.EffectManager;
  if (!EM?.endEffects || !token) return;
  const nome = nomeAaDoToken(token);
  try { EM.endEffects({ name: nome, object: token }); } catch (e) { /* nada a encerrar */ }
  try { EM.endEffects({ name: nome }); } catch (e) { /* idem */ }
}

/**
 * Põe os visuais de um ator exatamente no estado que a ficha dele pede.
 *
 * Por que apagar tudo e reacender: o Automated Animations batiza todo visual
 * que coloca num token como "spot <id do token>", sem distinguir de qual
 * efeito ele veio. Encerrar "só o efeito que saiu" é impossível por nome, e o
 * `origin` nem sempre chega ao cliente que precisa encerrar. Então zeramos os
 * nossos visuais naquele token e tocamos de novo os que continuam ativos.
 *
 * @param {Actor} actor
 * @param {Array<{fx:object, name:string, item?:Item}>} ativos o que deve estar tocando
 */
export async function resyncEffectFx(actor, ativos = []) {
  const token = activeTokenOf(actor);
  if (!token) return;

  // 1) Apaga os nossos: os do Automated Animations (nome por token) e os que
  //    tocamos direto pelo Sequencer (nome por efeito).
  endAllAaFxOnToken(token);
  for (const nome of origemPorNome.keys()) {
    if (typeof nome === "string" && nome.startsWith(persistentFxName(""))) endPersistentFx(nome);
  }

  // 2) Reacende o que continua valendo.
  for (const { fx, name, item } of ativos) {
    if (!fx || !name) continue;
    await playEffectFx({ actor, fx, name, item: item ?? null });
  }
}

/**
 * Encerra visuais de efeito que ficaram órfãos: animações persistentes
 * nossas (origin "ligeia-fx-…") cujo efeito já não existe mais em ninguém.
 *
 * Serve de rede de segurança para o que escapou — uma troca de cena no meio
 * do caminho, um cliente que caiu, ou visuais presos por uma versão antiga do
 * sistema, que não sabia encerrar as animações puxadas.
 *
 * @param {Iterable<string>} nomesVivos nomes que DEVEM continuar tocando
 */
export function limparFxOrfaos(nomesVivos = []) {
  try {
    const EM = globalThis.Sequencer?.EffectManager;
    if (!EM?.getEffects) return 0;
    const vivos = new Set(nomesVivos);
    const prefixo = persistentFxName("");
    const origens = new Set();
    for (const efeito of EM.getEffects() || []) {
      const origin = efeito?.data?.origin ?? efeito?.origin ?? "";
      if (typeof origin !== "string" || !origin.startsWith(prefixo)) continue;
      if (vivos.has(origin)) continue;
      origens.add(origin);
    }
    for (const origin of origens) {
      try { EM.endEffects({ origin }); } catch (e) { /* segue para os outros */ }
    }
    return origens.size;
  } catch (e) {
    console.warn("Ligeia | falha ao limpar visuais órfãos:", e);
    return 0;
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
