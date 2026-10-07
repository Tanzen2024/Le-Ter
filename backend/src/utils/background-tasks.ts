/**
 * Suivi des commandes système lancées en arrière-plan (expiration d'un timer, ouverture
 * d'une ronde après une fin de partie). Elles ne bloquent pas l'appelant, mais l'arrêt du
 * serveur (ou la fin d'un test) peut attendre qu'elles soient terminées (`idle`) avant de
 * fermer la base, au lieu de les couper en pleine transaction.
 */
export class BackgroundTasks {
  private readonly pending = new Set<Promise<unknown>>();

  /** Lance la tâche ; ses erreurs doivent être gérées par l'appelant (journal). */
  run(task: () => Promise<unknown>): void {
    const promise = task().finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }

  /** Résolue quand plus aucune tâche n'est en cours (y compris celles lancées entre-temps). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}
