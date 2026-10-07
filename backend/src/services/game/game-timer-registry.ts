import type { GameId } from '../../domain/game/game-id';
import type { SessionId } from '../../domain/sessions/session';

/**
 * Timers en mémoire, un au plus par clé (gameId ou sessionId). Il n'existe aucun timer
 * global : armer, réarmer ou annuler le timer de A n'a aucun effet sur B.
 *
 * Un timer n'est qu'une COPIE VOLATILE d'une échéance persistée dans PostgreSQL
 * (`games.turn_deadline_at`, `session_decision_rounds.deadline_at`, D-034) : il ne fait
 * que déclencher une commande métier (GameService / SessionService) qui relit l'état et
 * vérifie elle-même l'échéance. Perdre un timer (redémarrage) ne perd donc rien : il est
 * reconstruit depuis la base (DeadlineSupervisor).
 */
export class KeyedTimerRegistry<K extends string> {
  private readonly timers = new Map<K, NodeJS.Timeout>();

  /** Arme (ou réarme) le timer de cette clé. L'ancien timer de cette clé est annulé. */
  schedule(key: K, delayMs: number, onExpire: () => void): void {
    this.cancel(key);
    const handle = setTimeout(
      () => {
        this.timers.delete(key);
        onExpire();
      },
      Math.max(0, delayMs),
    );
    // Un timer ne retient pas le processus : l'arrêt du serveur n'attend pas une échéance.
    handle.unref();
    this.timers.set(key, handle);
  }

  cancel(key: K): boolean {
    const handle = this.timers.get(key);
    if (!handle) {
      return false;
    }
    clearTimeout(handle);
    this.timers.delete(key);
    return true;
  }

  has(key: K): boolean {
    return this.timers.has(key);
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

/** Timers de tour (TURN_TIMEOUT), un par partie. */
export class GameTimerRegistry extends KeyedTimerRegistry<GameId> {}

/** Timers de décision Poursuivre/Quitter (AUTO_LEAVE), un par session. */
export class SessionTimerRegistry extends KeyedTimerRegistry<SessionId> {}
