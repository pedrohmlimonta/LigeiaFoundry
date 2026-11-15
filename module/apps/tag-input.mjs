/**
 * CAMPO DE ETIQUETAS (estilo Selectize)
 * ===========================================================================
 * Um campo onde cada valor escolhido vira uma etiqueta removível, com uma
 * lista suspensa que filtra conforme se digita — e que aceita um termo NOVO,
 * digitado na hora, sem precisar de vírgula nem de um campo separado.
 *
 * É usado nas tipagens de arma, mas não sabe nada sobre elas: recebe a lista
 * de sugestões e o que já está escolhido, e avisa quem o montou quando a
 * escolha muda. Quem grava é a ficha.
 *
 * Como funciona:
 *  - clicar na caixa foca o campo e abre a lista;
 *  - digitar filtra (sem acento e sem diferenciar maiúsculas);
 *  - ↑/↓ andam pela lista, Enter escolhe o item em destaque;
 *  - se o que foi digitado não está na lista, aparece "Criar «termo»";
 *  - Backspace com o campo vazio tira a última etiqueta;
 *  - Esc fecha a lista.
 */

/** Normaliza para comparar: sem acento, minúsculas, sem espaços nas pontas. */
function dobrar(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase();
}

/**
 * Liga o comportamento em todos os campos de etiqueta dentro de um elemento.
 *
 * Espera a estrutura montada pelo template:
 *   .lig-tagsel > .lig-tagsel-box > (.lig-tagsel-chip* + input.lig-tagsel-input)
 *                 .lig-tagsel-menu
 *
 * As sugestões vêm de um <script type="application/json"> dentro do campo,
 * no formato [{id, label}] — assim o template não precisa gerar JS.
 *
 * @param {HTMLElement} root   elemento onde procurar os campos
 * @param {object} manipuladores
 * @param {(id:string, campo:HTMLElement) => any} manipuladores.onAdd
 * @param {(id:string, campo:HTMLElement) => any} manipuladores.onRemove
 * @param {() => boolean} [manipuladores.editable] se false, o campo fica só de leitura
 */
export function activateTagInputs(root, { onAdd, onRemove, editable } = {}) {
  if (!root) return;
  for (const campo of root.querySelectorAll(".lig-tagsel")) {
    montarUm(campo, { onAdd, onRemove, editable });
  }
}

function montarUm(campo, { onAdd, onRemove, editable }) {
  const input = campo.querySelector(".lig-tagsel-input");
  const menu = campo.querySelector(".lig-tagsel-menu");
  const caixa = campo.querySelector(".lig-tagsel-box");
  if (!input || !menu || !caixa) return;

  const podeEditar = editable ? !!editable() : true;
  if (!podeEditar) {
    input.disabled = true;
    campo.classList.add("disabled");
    return;
  }

  // Sugestões e o que já está escolhido.
  const dados = campo.querySelector("script.lig-tagsel-data");
  let sugestoes = [];
  try { sugestoes = JSON.parse(dados?.textContent || "[]"); }
  catch (e) { sugestoes = []; }
  const escolhidas = new Set(
    [...campo.querySelectorAll(".lig-tagsel-chip")].map((c) => dobrar(c.dataset.tag)),
  );
  // Permitir inventar um termo é opcional; nas tipagens está ligado.
  const podeCriar = campo.dataset.allowNew !== "false";

  let destaque = 0;

  /** Linhas que casam com o que está digitado, mais a de criar quando cabe. */
  function candidatos() {
    const busca = dobrar(input.value);
    const livres = sugestoes.filter(
      (s) => !escolhidas.has(dobrar(s.id)) && (!busca || dobrar(s.label).includes(busca)),
    );
    const lista = livres.map((s) => ({ id: s.id, label: s.label, novo: false }));
    // "Criar" só aparece com algo digitado que ainda não existe — nem na
    // lista, nem entre as já escolhidas.
    //
    // E vai no FIM, nunca no começo: digitar "cajad" tem de deixar "Cajados"
    // em destaque, para que o Enter escolha a tipagem existente em vez de
    // inventar uma chamada "cajad". Para criar de propósito, desce-se até
    // ela — ou não há nada parecido, e aí ela já é a única da lista.
    if (podeCriar && busca) {
      const jaExiste = sugestoes.some((s) => dobrar(s.label) === busca || dobrar(s.id) === busca);
      if (!jaExiste && !escolhidas.has(busca)) {
        lista.push({ id: input.value.trim(), label: input.value.trim(), novo: true });
      }
    }
    return lista;
  }

  function desenharMenu() {
    const lista = candidatos();
    if (destaque >= lista.length) destaque = Math.max(0, lista.length - 1);
    if (!lista.length) {
      menu.innerHTML = `<div class="lig-tagsel-vazio">Nada mais a escolher.</div>`;
      return lista;
    }
    menu.innerHTML = lista.map((c, i) => {
      const classes = ["lig-tagsel-opt"];
      if (i === destaque) classes.push("on");
      // A linha de criar ganha um traço acima quando vem depois de
      // sugestões, para não se confundir com elas.
      if (c.novo) classes.push(i > 0 ? "novo separado" : "novo");
      const texto = c.novo ? `Criar «${escapar(c.label)}»` : escapar(c.label);
      return `<div class="${classes.join(" ")}" data-i="${i}">${texto}</div>`;
    }).join("");
    return lista;
  }

  function abrir() {
    destaque = 0;
    desenharMenu();
    campo.classList.add("aberto");
    menu.hidden = false;
  }
  function fechar() {
    campo.classList.remove("aberto");
    menu.hidden = true;
  }

  function escolher(c) {
    if (!c) return;
    input.value = "";
    fechar();
    onAdd?.(c.id, campo);
  }

  // ----- Eventos -----
  caixa.addEventListener("mousedown", (ev) => {
    // Clicar no ✕ de uma etiqueta não deve abrir a lista.
    if (ev.target.closest(".lig-tagsel-x")) return;
    ev.preventDefault();
    input.focus();
    if (menu.hidden) abrir();
  });

  input.addEventListener("focus", () => { if (menu.hidden) abrir(); });
  input.addEventListener("input", () => { destaque = 0; desenharMenu(); menu.hidden = false; campo.classList.add("aberto"); });

  input.addEventListener("keydown", (ev) => {
    const lista = candidatos();
    switch (ev.key) {
      case "ArrowDown":
        ev.preventDefault();
        destaque = Math.min(destaque + 1, Math.max(0, lista.length - 1));
        desenharMenu(); menu.hidden = false;
        break;
      case "ArrowUp":
        ev.preventDefault();
        destaque = Math.max(destaque - 1, 0);
        desenharMenu(); menu.hidden = false;
        break;
      case "Enter":
        // Enter aqui NÃO pode enviar o formulário da ficha.
        ev.preventDefault();
        ev.stopPropagation();
        escolher(lista[destaque]);
        break;
      case "Escape":
        if (!menu.hidden) { ev.preventDefault(); ev.stopPropagation(); fechar(); }
        break;
      case "Backspace": {
        if (input.value) break; // só com o campo vazio
        const ultima = [...campo.querySelectorAll(".lig-tagsel-chip")].pop();
        if (ultima) { ev.preventDefault(); onRemove?.(ultima.dataset.tag, campo); }
        break;
      }
      default:
        break;
    }
  });

  // Vírgula e ponto-e-vírgula também fecham uma etiqueta, para quem está
  // acostumado a digitar separado por vírgula.
  input.addEventListener("keypress", (ev) => {
    if (ev.key !== "," && ev.key !== ";") return;
    ev.preventDefault();
    const texto = input.value.trim();
    if (!texto) return;
    const lista = candidatos();
    escolher(lista.find((c) => dobrar(c.label) === dobrar(texto)) || { id: texto });
  });

  menu.addEventListener("mousedown", (ev) => {
    const alvo = ev.target.closest(".lig-tagsel-opt");
    if (!alvo) return;
    ev.preventDefault();
    escolher(candidatos()[Number(alvo.dataset.i)]);
  });

  for (const x of campo.querySelectorAll(".lig-tagsel-x")) {
    x.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onRemove?.(x.closest(".lig-tagsel-chip")?.dataset.tag, campo);
    });
  }

  // Fechar ao clicar fora ou ao sair do campo.
  input.addEventListener("blur", () => setTimeout(() => fechar(), 120));
}

/** Escapa texto para interpolar em HTML. */
function escapar(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
