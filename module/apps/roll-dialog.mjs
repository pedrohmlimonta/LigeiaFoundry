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

/** Monta o HTML da caixa. */
function buildContent({ improvement, targets, defenseAttr, difficulty, allowDefense }) {
  const cfg = CONFIG.LIGEIA || {};
  const impLabel =
    improvement > 0 ? `+${improvement}D (vantagem)` :
    improvement < 0 ? `${improvement}D (desvantagem)` : "nenhum";

  let defenseBlock = "";
  if (allowDefense && targets.length) {
    const names = targets.map((a) => a.name).join(", ");
    const opts = Object.entries(cfg.defenseAttrs || {})
      .map(([k, v]) => `<option value="${k}" ${k === defenseAttr ? "selected" : ""}>${v}</option>`)
      .join("");
    defenseBlock = `
      <div class="lig-rd-row">
        <label>Defesa de ${names}
          <select name="defenseAttr">
            <option value="">— usar a CD abaixo —</option>
            ${opts}
          </select>
        </label>
      </div>
      <p class="lig-hint">Escolhendo um atributo, o alvo rola a defesa e o resultado vira a dificuldade.</p>`;
  }

  return `
    <form class="lig-roll-dialog">
      <div class="lig-rd-row">
        <label>Bônus / Penalidade
          <input type="number" name="bonus" value="0" step="1"/>
        </label>
        <label>Dados de melhoria (+ / −)
          <input type="number" name="diceDelta" value="0" step="1"/>
        </label>
      </div>
      <p class="lig-hint">Dados de melhoria da rolagem: <strong>${impLabel}</strong>. Remover além do que existe tira dos 2 dados básicos (mínimo 1).</p>
      <div class="lig-rd-row">
        <label>Dificuldade (CD) — vazio = sem CD
          <input type="number" name="difficulty" value="${difficulty ?? ""}" step="1"/>
        </label>
      </div>
      ${defenseBlock}
    </form>`;
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

  // DialogV2 (V13+); cai para o Dialog antigo se necessário.
  const DV2 = foundry?.applications?.api?.DialogV2;
  if (DV2?.wait) {
    const out = await DV2.wait({
      window: { title },
      content,
      buttons: [
        {
          action: "roll",
          label: "Rolar",
          default: true,
          callback: (event, button) => parse(button.form),
        },
        { action: "cancel", label: "Cancelar", callback: () => null },
      ],
      rejectClose: false,
      close: () => null,
    }).catch(() => null);
    return out && typeof out === "object" ? out : null;
  }

  return new Promise((resolve) => {
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
    });
    dlg.render(true);
  });
}
