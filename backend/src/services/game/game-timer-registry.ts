import type { GameId } from '../../domain/game/game-id';

/**
 * Un timer au plus par partie, indexé par gameId. Il n'existe aucun timer
 * global : armer, réarmer ou annuler le timer de A n'a aucun effet sur B.
 *
 * La durée n'est pas définie ici (règle encore ambiguë, docs/TODO.md R-06) :
 * elle est fournie par l'appelant.
 */
export class GameTimerRegistry {
  private readonly timers = new Map<GameId, NodeJS.Timeout>();

  /** Arme (ou réarme) le timer de la partie. L'ancien timer de cette partie est annulé. */
  schedule(gameId: GameId, delayMs: number, onExpire: () => void): void {
    this.cancel(gameId);
    const handle = setTimeout(() => {
      this.timers.delete(gameId);
      onExpire();
    }, delayMs);
    this.timers.set(gameId, handle);
  }

  cancel(gameId: GameId): boolean {
    const handle = this.timers.get(gameId);
    if (!handle) {
      return false;
    }
    clearTimeout(handle);
    this.timers.delete(gameId);
    return true;
  }

  has(gameId: GameId): boolean {
    return this.timers.has(gameId);
  }

  get size(): number {
    return this.timers.size;
  }

  /** Arrêt du serveur. */
  cancelAll(): void {
    for (const handle of this.timers.values()) {
      clearTimeout(handle);
    }
    this.timers.clear();
  }
}
