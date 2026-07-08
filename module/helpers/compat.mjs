/**
 * Utilidades de compatibilidade entre versões do Foundry VTT.
 *
 * O sistema suporta V13 e V14. A maior diferença é que o V14 REMOVEU os
 * Measured Templates (documento "MeasuredTemplate"), substituindo-os por
 * Template Regions. Enquanto a área/aura visual não é reescrita para Regions,
 * usamos estes helpers para detectar a capacidade e degradar com elegância no
 * V14 (sem quebrar), mantendo o restante do sistema funcionando.
 */

/** Geração principal do Foundry em execução (13, 14, …). */
export function foundryGeneration() {
  const g = game?.release?.generation;
  if (Number.isFinite(g)) return g;
  // Fallback: tenta extrair de game.version (ex.: "14.364")
  const v = parseInt(String(game?.version || "0").split(".")[0], 10);
  return Number.isFinite(v) ? v : 0;
}

/** É Foundry V14 ou mais novo? */
export function isV14Plus() {
  return foundryGeneration() >= 14;
}

/**
 * Os Measured Templates estão disponíveis nesta versão?
 * (V13: sim; V14: removidos em favor de Template Regions.)
 */
export function measuredTemplatesAvailable() {
  // O documento e a classe de objeto só existem enquanto os Measured
  // Templates fizerem parte do core (V13 e anteriores).
  const hasDocClass = !!CONFIG?.MeasuredTemplate?.documentClass;
  const hasObjClass =
    !!(foundry?.canvas?.placeables?.MeasuredTemplate) ||
    !!CONFIG?.MeasuredTemplate?.objectClass;
  return hasDocClass || hasObjClass;
}
