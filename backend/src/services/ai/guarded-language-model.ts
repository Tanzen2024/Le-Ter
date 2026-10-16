import { ModelUnavailableError, type LanguageModel, type ModelRequest } from './language-model';

export interface ModelGuardOptions {
  /** Appels simultanés (1 sur un serveur sans GPU : les appels se suivent). */
  maxConcurrent: number;
  /** Appels en attente au-delà desquels on répond « occupé » plutôt que d'empiler. */
  maxQueued: number;
  /** Échecs consécutifs qui ouvrent le disjoncteur. */
  failureThreshold: number;
  /** Durée pendant laquelle le modèle n'est plus appelé après l'ouverture du disjoncteur. */
  cooldownMs: number;
  clock?: () => number;
}

/**
 * Protection de coût et de disponibilité autour d'un modèle (D-114) :
 * - concurrence bornée et file d'attente bornée (un modèle sur CPU ne sert qu'un appel à la
 *   fois ; au-delà, `BUSY` immédiat, le joueur garde le mode dégradé) ;
 * - disjoncteur : après N échecs consécutifs (délai dépassé, Ollama arrêté), plus aucun appel
 *   pendant `cooldownMs` — chaque message n'attend pas un délai complet pour rien.
 */
export class GuardedLanguageModel implements LanguageModel {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private failures = 0;
  private openUntil = 0;
  private readonly clock: () => number;

  constructor(
    private readonly inner: LanguageModel,
    private readonly options: ModelGuardOptions,
  ) {
    this.clock = options.clock ?? Date.now;
  }

  get provider() {
    return this.inner.provider;
  }

  get model() {
    return this.inner.model;
  }

  /** Disjoncteur fermé : le modèle est réputé joignable. */
  available(): boolean {
    return this.clock() >= this.openUntil;
  }

  async generate(request: ModelRequest): Promise<string> {
    if (!this.available()) throw new ModelUnavailableError('CIRCUIT_OPEN');
    if (this.active >= this.options.maxConcurrent) {
      if (this.waiting.length >= this.options.maxQueued) throw new ModelUnavailableError('BUSY');
      // La place est transmise directement par l'appel qui se termine (aucun dépassement).
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      const output = await this.inner.generate(request);
      this.failures = 0;
      return output;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.options.failureThreshold) {
        this.openUntil = this.clock() + this.options.cooldownMs;
        this.failures = 0;
      }
      throw err instanceof ModelUnavailableError ? err : new ModelUnavailableError('NETWORK');
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
