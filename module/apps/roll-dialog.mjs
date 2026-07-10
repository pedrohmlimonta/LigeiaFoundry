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
  if (actor?.system?.skipRollDialog) return false;
  // Nas ações, a caixa é DESLIGADA por padrão (skipRollDialog = true).
  if (action && action.skipRollDialog !== false) return false;
  return true;
}

/** Atores atualmente marcados como alvo pelo usuário. */
export function currentTargetActors() {
  return Array.from(game.user?.targets ?? []).map((t) => t.actor).filter(Boolean);
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
function buildContent({ improvement, targets, defenseAttr, difficulty, allowDefense }) {
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

      <div class="lig-rd-row">
        <label class="lig-rd-field lig-rd-wide">
          <span class="lig-rd-label">Dificuldade (CD)</span>
          <input type="number" name="difficulty" value="${difficulty ?? ""}" step="1" placeholder="vazio = sem CD"/>
        </label>
      </div>

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
} = {}) {
  const targets = allowDefense ? currentTargetActors() : [];
  const content = buildContent({ improvement, targets, defenseAttr, difficulty, allowDefense });

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
