/**
 * Caixa de diálogo mostrada ANTES de uma rolagem.
 *
 * Permite ajustar, na hora:
 *   - Bônus / Penalidade (somado ao total)
 *   - Dados de melhoria (+ adiciona, − remove)
 *   - Dificuldade (CD) ou, havendo alvo marcado, o atributo de DEFESA do alvo
 *
 * Regra dos dados (pedido do autor): remover dados de melhoria primeiro
 * consome os dados de melhoria existentes; quando não há mais nenhum, passa a
 * remover dos 2 dados BÁSICOS, até o mínimo de 1 dado.
 *
 * A caixa é pulada quando:
 *   - o ator tem "Não abrir caixa de rolagem" ligado na ficha; ou
 *   - a ação tem "Não abrir caixa de rolagem" ligado (padrão das ações).
 */

/**
 * Aplica um delta de dados sobre os dados de melhoria, com transbordo para os
 * dados básicos.
 *
 * @param {number} improvement  dados de melhoria atuais (negativo = desvantagem)
 * @param {number} delta        quanto adicionar (+) ou remover (−)
 * @returns {{improvement:number, baseDice:number}}
 */
export function applyDiceDelta(improvement, delta) {
  const imp0 = Number(improvement) || 0;
  let imp = imp0 + (Number(delta) || 0);
  let baseDice = 2;
  // Só transborda para os dados básicos quando a rolagem NÃO estava em
  // desvantagem: aí "remover dados" significa tirar dos 2 dados básicos.
  if (imp < 0 && imp0 >= 0) {
    baseDice = Math.max(1, 2 + imp); // -1 → 1 dado básico; -2 ou menos → 1
    imp = 0;
  }
  return { improvement: imp, baseDice };
}

/** O diálogo deve ser mostrado para esta rolagem? */
export function shouldPromptRoll(actor, action = null) {
  // Disparos automáticos (emanações que reaplicam a ação a cada turno) nunca
  // abrem caixa — ninguém está clicando para que ela apareça.
  if (action?.autoTrigger) return false;
  // Único interruptor: a checkbox "sem caixa" da ficha do personagem.
  // (O antigo "não abrir caixa" por ação não é mais consultado: a caixa deve
  //  aparecer em todas as rolagens de quem não marcou "sem caixa".)
  if (actor?.system?.skipRollDialog) return false;
  return true;
}

/** Atores atualmente marcados como alvo pelo usuário. */
export function currentTargetActors() {
  return Array.from(game.user?.targets ?? []).map((t) => t.actor).filter(Boolean);
}

/**
 * Pergunta QUANTO recurso o personagem quer gastar nesta ação.
 *
 * Para as ações de custo escolhido: a pessoa decide quanta mana (ou vida,
 * ou pontos heroicos) canalizar, e a ação cresce com isso. A caixa mostra
 * o que o personagem tem, o mínimo e o máximo, e o que cada ponto amplia.
 *
 * @param {Actor} actor
 * @param {object} cfg  { titulo, recurso, min, max, disponivel, explica }
 * @returns {Promise<number|null>} quanto gastar, ou null se cancelou
 */
export async function pedirGastoVariavel(actor, { titulo, recurso, min, max, disponivel, explica }) {
  const nomes = { mp: "PM", hp: "PV", hpTemp: "PV temporário", heroic: "PH" };
  const curto = nomes[recurso] || recurso;
  const teto = max > 0 ? Math.min(max, disponivel) : disponivel;

  // Sem recurso suficiente nem para o mínimo, nem adianta perguntar.
  if (teto < min) {
    ui.notifications?.warn(`${actor?.name || "O personagem"} não tem ${min} ${curto} para usar ${titulo}.`);
    return null;
  }

  const escolhido = await foundry.applications.api.DialogV2.wait({
    window: { title: `${titulo} — quanto gastar` },
    content: `
      <p class="lig-hint">${explica || `Escolha quanto ${curto} canalizar.`}</p>
      <label>Gastar (${curto})
        <input type="number" name="gasto" value="${min}" min="${min}" max="${teto}" step="1" autofocus/>
      </label>
      <p class="lig-hint">Disponível: <strong>${disponivel}</strong> ${curto} · mínimo ${min}${max > 0 ? ` · máximo ${max}` : ""}</p>`,
    buttons: [
      {
        action: "ok", label: "Usar", default: true,
        callback: (ev, btn) => {
          const v = Math.round(Number(btn.form.elements.gasto?.value) || 0);
          return Math.max(min, Math.min(teto, v));
        },
      },
      { action: "cancel", label: "Cancelar" },
    ],
    rejectClose: false,
  });

  if (escolhido === "cancel" || escolhido == null || Number.isNaN(Number(escolhido))) return null;
  return Number(escolhido);
}

/**
 * Pergunta QUAL criatura do cardápio a conjuração vai trazer.
 *
 * A ação conjura uma de cada vez: a lista do item é um cardápio, e aqui se
 * escolhe o prato. A marcada na ficha já vem selecionada, então quem não
 * quer pensar é só confirmar.
 *
 * @param {Array} cardapio  entradas com { index, actorName, count, rounds }
 * @param {number} marcado  índice que já vem escolhido
 * @returns {Promise<number|null>} o índice escolhido, ou null se cancelou
 */
export async function pedirCriaturaConjurada(cardapio, marcado = 0) {
  const linhas = cardapio.map((c) => {
    const quantas = String(c.countEff ?? c.count ?? "1").trim();
    const nQuantas = quantas && quantas !== "1" ? ` <span class="lig-rd-sub">(${quantas})</span>` : "";
    const dura = Number(c.rounds) > 0 ? ` <span class="lig-rd-sub">· ${c.rounds} rodadas</span>` : "";
    return `
      <label class="lig-rd-pick">
        <input type="radio" name="criatura" value="${c.index}" ${c.index === marcado ? "checked" : ""}/>
        <span><strong>${c.actorName || "(ficha removida)"}</strong>${nQuantas}${dura}</span>
      </label>`;
  }).join("");

  const DV2 = foundry?.applications?.api?.DialogV2;
  if (!DV2?.wait) return marcado;

  const out = await DV2.wait({
    window: { title: "Conjuração — qual criatura?" },
    classes: ["ligeia", "lig-roll-dialog-window"],
    content: `<form class="lig-roll-dialog" autocomplete="off">
      <p class="lig-rd-hint">A ação conjura uma criatura por vez, na quantidade indicada.</p>
      ${linhas}
    </form>`,
    buttons: [
      {
        action: "ok", label: "Conjurar", icon: "fas fa-paw", default: true,
        callback: (event, button) => {
          const escolhido = button.form?.querySelector?.('input[name="criatura"]:checked');
          const v = Number(escolhido?.value);
          return Number.isFinite(v) ? v : marcado;
        },
      },
      { action: "cancel", label: "Cancelar", icon: "fas fa-times", callback: () => null },
    ],
    rejectClose: false,
    close: () => null,
  }).catch(() => null);

  return typeof out === "number" ? out : null;
}

/**
 * Mostra os efeitos que a dissipação alcançou e deixa escolher quais tirar.
 *
 * A lista vem de todos os alvos atingidos de uma vez, agrupada por quem
 * carrega cada efeito, e o limite é o da ação: marcar mais do que ele
 * desmarca o mais antigo, de modo que nunca dá para passar do que se pode
 * anular. Com limite 0 não há teto — marca-se o que quiser.
 *
 * @param {Array} candidatos  [{ id, label, alvo, classe, fonte }]
 * @param {number} limite     quantos podem sair (0 = sem limite)
 * @returns {Promise<string[]|null>} os ids escolhidos, ou null se cancelou
 */
export async function pedirEfeitosParaRemover(candidatos, limite = 0) {
  if (!candidatos?.length) return [];
  const DV2 = foundry?.applications?.api?.DialogV2;
  // Sem caixa disponível, leva os primeiros — o mesmo que a regra automática.
  if (!DV2?.wait) return candidatos.slice(0, limite > 0 ? limite : candidatos.length).map((c) => c.id);

  // Agrupa por alvo: numa dissipação em área, saber de quem é cada efeito é
  // metade da decisão.
  const porAlvo = new Map();
  for (const c of candidatos) {
    if (!porAlvo.has(c.alvo)) porAlvo.set(c.alvo, []);
    porAlvo.get(c.alvo).push(c);
  }
  const vários = porAlvo.size > 1;
  const corpo = [...porAlvo.entries()].map(([alvo, lista]) => {
    const linhas = lista.map((c) => `
      <label class="lig-rd-pick">
        <input type="checkbox" name="fx" value="${c.id}"/>
        <span><strong>${c.label}</strong>${c.classe ? ` <span class="lig-rd-sub">(${c.classe})</span>` : ""}${c.fonte ? ` <span class="lig-rd-sub">· de ${c.fonte}</span>` : ""}</span>
      </label>`).join("");
    return vários ? `<div class="lig-rd-group"><div class="lig-rd-group-title">${alvo}</div>${linhas}</div>` : linhas;
  }).join("");

  const teto = limite > 0
    ? `<p class="lig-rd-hint">Você pode anular até <strong>${limite}</strong>. Marcar além disso solta o mais antigo.</p>`
    : `<p class="lig-rd-hint">Sem limite: marque o que quiser anular.</p>`;

  // O limite é segurado enquanto a caixa está aberta: o excedente se
  // desmarca sozinho, em vez de avisar depois que já foi.
  const segurarLimite = (ev) => {
    const form = ev.target?.closest?.("form.lig-roll-dialog");
    if (!form || ev.target?.name !== "fx" || limite <= 0) return;
    const marcados = [...form.querySelectorAll('input[name="fx"]:checked')];
    while (marcados.length > limite) marcados.shift().checked = false;
  };
  document.addEventListener("change", segurarLimite, true);

  try {
    const out = await DV2.wait({
      window: { title: "Anular efeitos — escolha quais" },
      classes: ["ligeia", "lig-roll-dialog-window"],
      content: `<form class="lig-roll-dialog" autocomplete="off">${teto}${corpo}</form>`,
      buttons: [
        {
          action: "ok", label: "Anular", icon: "fas fa-ban", default: true,
          callback: (event, button) => [...button.form.querySelectorAll('input[name="fx"]:checked')].map((i) => i.value),
        },
        { action: "cancel", label: "Cancelar", icon: "fas fa-times", callback: () => null },
      ],
      rejectClose: false,
      close: () => null,
    }).catch(() => null);
    return Array.isArray(out) ? out : null;
  } finally {
    document.removeEventListener("change", segurarLimite, true);
  }
}

/**
 * Arma a mira: o PRÓXIMO CLIQUE num token escolhe o alvo e já dispara.
 *
 * Usado pelas ações em cadeia marcadas como "Variável". Não há janela nem
 * botão de confirmar — clicar no inimigo É a confirmação, e a ação sai na
 * hora. Assim, uma cadeia de três ataques vira três cliques seguidos, cada
 * um num alvo diferente.
 *
 * Botão direito ou Esc pulam a ação. O token clicado também fica marcado
 * como alvo, para que a animação e o resto do sistema vejam o mesmo que o
 * jogador acabou de escolher.
 *
 * @param {string} titulo  nome da ação que vai sair no clique
 * @returns {Promise<Actor[]|null>} o ator clicado, ou null se desistiu
 */
export async function pedirAlvoPorClique(titulo) {
  const canvas = globalThis.canvas;
  if (!canvas?.ready || !canvas.stage || !canvas.tokens) return null;

  return new Promise((resolve) => {
    let encerrado = false;

    /** Ponto da cena sob o cursor, nas várias versões de PIXI/Foundry. */
    const ponto = (event) => {
      try {
        if (typeof event?.getLocalPosition === "function") return event.getLocalPosition(canvas.tokens);
        if (event?.data?.getLocalPosition) return event.data.getLocalPosition(canvas.tokens);
      } catch (e) { /* cai no cursor global */ }
      return canvas.mousePosition || null;
    };

    /** O token visível sob aquele ponto (o de cima, se houver pilha). */
    const tokenEm = (p) => {
      if (!p) return null;
      const candidatos = canvas.tokens.placeables.filter(
        (tk) => tk.visible && tk.actor && tk.bounds?.contains?.(p.x, p.y),
      );
      if (!candidatos.length) return null;
      return candidatos.sort((a, b) => (b.document?.sort ?? 0) - (a.document?.sort ?? 0))[0];
    };

    const limpar = () => {
      encerrado = true;
      canvas.stage.off("mousedown", aoClicar);
      if (canvas.app?.view) canvas.app.view.oncontextmenu = null;
      document.removeEventListener("keydown", aoTeclar, true);
    };

    const desistir = (event) => {
      event?.preventDefault?.();
      if (encerrado) return;
      limpar();
      resolve(null);
    };

    const aoTeclar = (event) => {
      if (event.key !== "Escape") return;
      // Esc aqui não pode fechar a ficha nem a janela de trás.
      event.preventDefault();
      event.stopPropagation();
      desistir();
    };

    const aoClicar = (event) => {
      if (encerrado) return;
      const tk = tokenEm(ponto(event));
      if (!tk) {
        // Clique fora de qualquer token: não é desistência, é mira errada.
        ui.notifications?.warn("Clique sobre um token. Botão direito ou Esc para pular.");
        return;
      }
      limpar();
      // Marca o alvo para o resto do sistema ver o mesmo que o jogador.
      try {
        tk.setTarget(true, { releaseOthers: true, groupSelection: false });
      } catch (e) { /* a mira é cosmética aqui; os alvos vão por parâmetro */ }
      resolve([tk.actor]);
    };

    canvas.stage.on("mousedown", aoClicar);
    if (canvas.app?.view) canvas.app.view.oncontextmenu = desistir;
    document.addEventListener("keydown", aoTeclar, true);
    ui.notifications?.info(`${titulo}: clique no alvo (botão direito ou Esc para pular).`);
  });
}

/** Lê um valor numérico de um formulário. */
function num(form, name, fallback = 0) {
  const el = form?.elements?.[name];
  if (!el) return fallback;
  const v = Number(el.value);
  return Number.isFinite(v) ? v : fallback;
}

/** Lê um valor de texto de um formulário. */
function str(form, name, fallback = "") {
  const el = form?.elements?.[name];
  return el ? String(el.value ?? fallback) : fallback;
}

/**
 * Descreve o conjunto de dados resultante, para a pré-visualização.
 * @returns {string} ex.: "3d6 — mantém os 2 maiores"
 */
export function describePool(improvement, baseDice) {
  const extra = Math.abs(improvement || 0);
  const total = baseDice + extra;
  if (improvement > 0) return `${total}d6 — mantém os ${baseDice} maiores`;
  if (improvement < 0) return `${total}d6 — mantém os ${baseDice} menores`;
  return baseDice === 1 ? "1d6 — dado básico reduzido" : `${total}d6`;
}

/** Um campo numérico com botões − e +. */
function stepperField(label, name, value, hint = "") {
  return `
    <label class="lig-rd-field">
      <span class="lig-rd-label">${label}</span>
      <span class="lig-rd-stepper">
        <button type="button" class="lig-rd-step" data-step="${name}" data-dir="-1" tabindex="-1">−</button>
        <input type="number" name="${name}" value="${value}" step="1"/>
        <button type="button" class="lig-rd-step" data-step="${name}" data-dir="1" tabindex="-1">+</button>
      </span>
      ${hint ? `<span class="lig-rd-sub">${hint}</span>` : ""}
    </label>`;
}

/** Monta o HTML da caixa. */
/**
 * O bloco da ECONOMIA DE AÇÕES na caixa de rolagem: qual ação esta rolagem
 * vai gastar, e quantas o personagem ainda tem de cada tipo.
 *
 * A escolha vale só para este uso — a ação configurada no item continua
 * como está. É o espaço para o "essa eu faço como ação simples" que a mesa
 * combina na hora.
 */
function actionCostBlock(pool, atual) {
  if (!pool) return "";
  const nomes = {
    none: "— nenhuma ação —", standard: "Ação padrão", movement: "Ação de movimento",
    simple: "Ação simples", reaction: "Reação", free: "Ação livre (infinitas)",
  };
  const opts = Object.entries(nomes).map(([k, rotulo]) => {
    const slot = pool[k];
    // Quantas restam, para a escolha ser informada. Livre e "nenhuma" não
    // têm contagem: não se esgotam.
    const resta = slot ? ` (${slot.available} de ${slot.max})` : "";
    const vazio = slot && slot.available <= 0 ? " ⚠" : "";
    return `<option value="${k}" ${k === atual ? "selected" : ""}>${rotulo}${resta}${vazio}</option>`;
  }).join("");
  return `
    <div class="lig-rd-row">
      <label class="lig-rd-field lig-rd-wide">
        <span class="lig-rd-label">Gasta</span>
        <select name="actionCost">${opts}</select>
        <span class="lig-rd-sub">A ação da rodada que este uso consome. Vale só desta vez.</span>
      </label>
    </div>`;
}

function buildContent({ improvement, targets, defenseAttr, difficulty, allowDefense, hint = "", showDifficulty = true, actionPool = null, actionCost = "none" }) {
  const cfg = CONFIG.LIGEIA || {};
  const impLabel =
    improvement > 0 ? `+${improvement}D vantagem` :
    improvement < 0 ? `${improvement}D desvantagem` : "sem dados de melhoria";

  let defenseBlock = "";
  if (allowDefense && targets.length) {
    const names = targets.map((a) => a.name).join(", ");
    const opts = Object.entries(cfg.defenseAttrs || {})
      .map(([k, v]) => `<option value="${k}" ${k === defenseAttr ? "selected" : ""}>${v}</option>`)
      .join("");
    defenseBlock = `
      <div class="lig-rd-row">
        <label class="lig-rd-field lig-rd-wide">
          <span class="lig-rd-label">Defesa de ${names}</span>
          <select name="defenseAttr">
            <option value="">— usar a CD ao lado —</option>
            ${opts}
          </select>
          <span class="lig-rd-sub">O alvo rola a defesa e o resultado vira a dificuldade.</span>
        </label>
      </div>`;
  }

  const preview = describePool(improvement, 2);

  return `
    <form class="lig-roll-dialog" autocomplete="off">
      <div class="lig-rd-row">
        ${stepperField("Bônus / Penalidade", "bonus", 0)}
        ${stepperField("Dados de melhoria", "diceDelta", 0, impLabel)}
      </div>

      <div class="lig-rd-preview" data-preview>
        <span class="lig-rd-dice">${preview}</span>
      </div>

      ${showDifficulty ? `
      <div class="lig-rd-row">
        <label class="lig-rd-field lig-rd-wide">
          <span class="lig-rd-label">Dificuldade (CD)</span>
          <input type="number" name="difficulty" value="${difficulty ?? ""}" step="1" placeholder="vazio = sem CD"/>
        </label>
      </div>` : ""}
      ${hint ? `<div class="lig-rd-hint">${hint}</div>` : ""}

      ${actionCostBlock(actionPool, actionCost)}

      ${defenseBlock}

      <p class="lig-rd-note">Remover além dos dados de melhoria tira dos 2 dados básicos, até o mínimo de 1.</p>
    </form>`;
}

/**
 * Liga os botões − / + e a pré-visualização. Usa um ouvinte delegado no
 * documento (funciona tanto no DialogV2 quanto no Dialog antigo).
 * @returns {Function} função de limpeza
 */
function wireSteppers(improvement) {
  const refresh = (form) => {
    const prev = form?.querySelector?.("[data-preview] .lig-rd-dice");
    if (!prev) return;
    const deltaEl = form.querySelector('[name="diceDelta"]');
    const delta = Number(deltaEl?.value) || 0;
    const { improvement: imp, baseDice } = applyDiceDelta(improvement, delta);
    prev.textContent = describePool(imp, baseDice);
    const bonus = Number(form.querySelector('[name="bonus"]')?.value) || 0;
    if (bonus) prev.textContent += bonus > 0 ? ` +${bonus}` : ` ${bonus}`;
  };

  const onClick = (ev) => {
    const btn = ev.target?.closest?.("form.lig-roll-dialog button[data-step]");
    if (!btn) return;
    ev.preventDefault();
    const form = btn.closest("form.lig-roll-dialog");
    const input = form?.querySelector(`[name="${btn.dataset.step}"]`);
    if (!input) return;
    input.value = String((Number(input.value) || 0) + (Number(btn.dataset.dir) || 0));
    refresh(form);
  };
  const onInput = (ev) => {
    const form = ev.target?.closest?.("form.lig-roll-dialog");
    if (form) refresh(form);
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("input", onInput, true);
  };
}

/**
 * Abre a caixa de rolagem e devolve os ajustes escolhidos.
 *
 * @returns {Promise<null | {bonus:number, improvement:number, baseDice:number,
 *   difficulty:(number|null), defenseAttr:string}>}  null se cancelado.
 */
export async function promptRollConfig({
  title = "Rolagem",
  improvement = 0,
  difficulty = null,
  defenseAttr = "",
  allowDefense = true,
  hint = "",
  showDifficulty = true,
  actionPool = null,
  actionCost = "none",
} = {}) {
  const targets = allowDefense ? currentTargetActors() : [];
  const content = buildContent({
    improvement, targets, defenseAttr, difficulty, allowDefense, hint, showDifficulty,
    actionPool, actionCost,
  });

  const parse = (form) => {
    const bonus = num(form, "bonus", 0);
    const delta = num(form, "diceDelta", 0);
    const dcRaw = str(form, "difficulty", "").trim();
    const dc = dcRaw === "" ? null : Number(dcRaw);
    const { improvement: imp, baseDice } = applyDiceDelta(improvement, delta);
    return {
      bonus,
      improvement: imp,
      baseDice,
      difficulty: Number.isFinite(dc) ? dc : null,
      defenseAttr: str(form, "defenseAttr", ""),
      // Só vem preenchido quando a economia de ações está ligada.
      actionCost: actionPool ? str(form, "actionCost", actionCost) : null,
    };
  };

  // Liga os botões − / + e a pré-visualização enquanto a caixa estiver aberta.
  const unwire = wireSteppers(improvement);

  try {
    // DialogV2 (V13+); cai para o Dialog antigo se necessário.
    const DV2 = foundry?.applications?.api?.DialogV2;
    if (DV2?.wait) {
      const out = await DV2.wait({
        window: { title },
        classes: ["ligeia", "lig-roll-dialog-window"],
        content,
        buttons: [
          {
            action: "roll",
            label: "Rolar",
            icon: "fas fa-dice",
            default: true,
            callback: (event, button) => parse(button.form),
          },
          { action: "cancel", label: "Cancelar", icon: "fas fa-times", callback: () => null },
        ],
        rejectClose: false,
        close: () => null,
      }).catch(() => null);
      return out && typeof out === "object" ? out : null;
    }

    return await new Promise((resolve) => {
      const dlg = new Dialog({
        title,
        content,
        buttons: {
          roll: {
            label: "Rolar",
            callback: (html) => {
              const form = html?.[0]?.querySelector?.("form") || html?.querySelector?.("form");
              resolve(parse(form));
            },
          },
          cancel: { label: "Cancelar", callback: () => resolve(null) },
        },
        default: "roll",
        close: () => resolve(null),
      }, { classes: ["ligeia", "lig-roll-dialog-window"] });
      dlg.render(true);
    });
  } finally {
    unwire();
  }
}
