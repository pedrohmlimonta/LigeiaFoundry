/**
 * Classe base de Actor do Ligeia.
 * A maior parte da lógica derivada vive nos DataModels (prepareDerivedData).
 * Métodos de conveniência (rolagens, descanso) serão adicionados nas
 * próximas fases.
 */
export class LigeiaActor extends Actor {
  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    // Os DataModels já calculam secundários/recursos via prepareDerivedData.
  }
}
