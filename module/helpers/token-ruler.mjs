/**
 * Medidor de movimento do token (drag ruler) colorido pelo Deslocamento.
 *
 * Ao arrastar um token, o rastro é pintado conforme a distância percorrida em
 * relação ao Deslocamento do personagem (system.secondary.deslocamento, que já
 * inclui bônus de raça/efeitos e a metade por Lento):
 *
 *   até 1× o deslocamento .......... VERDE   (movimento normal)
 *   de 1× até 2× o deslocamento .... AMARELO (movimento estendido/corrida)
 *   acima de 2× o deslocamento ..... VERMELHO (além do dobro)
 *
 * Implementado estendendo `TokenRuler` (V13+) e sobrescrevendo os estilos do
 * segmento, do marcador de waypoint e do destaque do grid. Se a API não existir
 * (versões antigas), o registro é ignorado sem quebrar nada.
 */

// Cores do rastro.
const COLOR_OK = 0x2ecc40;    // verde  — dentro do deslocamento
const COLOR_WARN = 0xffdc00;  // amarelo — até o dobro
const COLOR_OVER = 0xff4136;  // vermelho — acima do dobro

/** Tolerância para comparações de ponto flutuante (medições do grid). */
const EPS = 1e-6;

/**
 * Distância percorrida até um waypoint, nas unidades da cena (metros).
 * Prefere o CUSTO do caminho (respeita terreno difícil); cai para a distância.
 */
function traveledAt(waypoint) {
  const m = waypoint?.measurement;
  if (!m) return 0;
  const cost = Number(m.cost);
  if (Number.isFinite(cost)) return cost;
  const dist = Number(m.distance);
  return Number.isFinite(dist) ? dist : 0;
}

/**
 * Cor do rastro para uma distância percorrida, dado o deslocamento do ator.
 * Retorna null quando não há deslocamento definido (usa a cor padrão do core).
 */
export function movementColor(traveled, speed) {
  const s = Number(speed) || 0;
  if (s <= 0) return null;
  if (traveled <= s + EPS) return COLOR_OK;
  if (traveled <= 2 * s + EPS) return COLOR_WARN;
  return COLOR_OVER;
}

/**
 * Registra o medidor de movimento do Ligeia (CONFIG.Token.rulerClass).
 * Chamado no hook `init`.
 */
export function registerTokenRuler() {
  const Base = foundry?.canvas?.placeables?.tokens?.TokenRuler;
  if (!Base) {
    console.warn("Ligeia | TokenRuler indisponível nesta versão; rastro colorido desativado.");
    return;
  }

  class LigeiaTokenRuler extends Base {
    /** Deslocamento (em metros) do ator deste token; 0 se indisponível. */
    get ligeiaSpeed() {
      return Number(this.token?.actor?.system?.secondary?.deslocamento) || 0;
    }

    /** Cor para um waypoint, ou null para manter o padrão do core. */
    #colorFor(waypoint) {
      return movementColor(traveledAt(waypoint), this.ligeiaSpeed);
    }

    /** Cor da LINHA do segmento (do waypoint anterior até este). */
    _getSegmentStyle(waypoint) {
      const style = super._getSegmentStyle(waypoint);
      const color = this.#colorFor(waypoint);
      if (color !== null) style.color = color;
      return style;
    }

    /** Cor do MARCADOR (bolinha) do waypoint. */
    _getWaypointStyle(waypoint) {
      const style = super._getWaypointStyle(waypoint);
      const color = this.#colorFor(waypoint);
      if (color !== null) style.color = color;
      return style;
    }

    /** Cor do DESTAQUE das casas do grid percorridas. */
    _getGridHighlightStyle(waypoint, offset) {
      const style = super._getGridHighlightStyle(waypoint, offset);
      // alpha 0 = casa não destacada; respeita a decisão do core.
      if (style?.alpha === 0) return style;
      const color = this.#colorFor(waypoint);
      if (color !== null) style.color = color;
      return style;
    }
  }

  CONFIG.Token.rulerClass = LigeiaTokenRuler;
}
