import { randomUUID } from 'node:crypto';

import {
  GAME_COMMISSION_LIMITS,
  GAME_COMMISSION_MAX_TIERS,
  KORA_LOSS_MULTIPLIER,
  type GameCommissionTier,
} from '../../domain/rules/game-settlement';
import type { UserId } from '../../domain/users/user';
import type {
  GameCommissionSetting,
  PostgresGameCommissionSettingsRepository,
} from '../../repositories/postgres-game-commission-settings.repository';
import type { Logger } from '../../utils/logger';

const view = (setting: GameCommissionSetting) => ({
  tiers: setting.tiers,
  updatedAt: setting.updatedAt?.toISOString() ?? null,
  /** Bornes du taux d'une tranche (%). */
  limits: GAME_COMMISSION_LIMITS,
  maxTiers: GAME_COMMISSION_MAX_TIERS,
  /** La victoire par Kora multiplie la perte de chaque perdant ; le taux reste celui de la tranche (D-080). */
  koraLossMultiplier: KORA_LOSS_MULTIPLIER,
  /** Le taux est figé au DÉMARRAGE de chaque partie : un changement ne vaut que pour la suite. */
  appliesTo: 'GAMES_STARTED_AFTER_CHANGE' as const,
});

/**
 * Barème de commission des parties (D-074, D-080) : un taux par tranche de mise, prélevé sur
 * les mises perdues (Kora : perte doublée, taux inchangé). Réglé par le rôle `admin` (contrôlé
 * par la route) et auditée. Le taux de la tranche de la mise est copié dans
 * `game_settlements.commission_bps` au démarrage de chaque partie : une modification ne touche ni les parties en cours, ni les
 * parties réglées (aucun recalcul rétroactif).
 */
export class GameCommissionSettingsService {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      repository: PostgresGameCommissionSettingsRepository;
      logger: Logger;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async get() {
    return view(await this.deps.repository.get());
  }

  /** Précondition : barème validé (`parseGameCommissionChange`). Identique : `changed: false`. */
  async set(tiers: readonly GameCommissionTier[], actorId: UserId) {
    const { setting, changed, previous } = await this.deps.repository.set({
      tiers,
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    if (changed) {
      this.deps.logger.info('game commission changed', {
        actorId,
        from: previous,
        to: setting.tiers,
      });
    }
    return { ...view(setting), changed };
  }
}
