/**
 * Exécute les tâches d'une même clé l'une après l'autre, et celles de clés
 * différentes en parallèle.
 *
 * Utilisée avec la clé `gameId` : deux commandes de la partie A sont traitées
 * dans l'ordre d'arrivée, sans jamais bloquer la partie B.
 */
export class KeyedSerialQueue<K> {
  private readonly tails = new Map<K, Promise<unknown>>();

  run<T>(key: K, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // L'échec d'une tâche ne doit pas bloquer les suivantes de la même clé.
    const result = previous.catch(() => undefined).then(task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      // Libère la clé si aucune tâche n'a été ajoutée entre-temps.
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
    return result;
  }

  /** Nombre de clés ayant des tâches en cours (utile pour les tests et métriques). */
  get activeKeys(): number {
    return this.tails.size;
  }
}
