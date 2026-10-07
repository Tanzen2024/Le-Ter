import type { PlayerId } from '../game/game-id';
import { UnresolvedRuleError } from './unresolved-rule';

/**
 * Domaine minimal des mises : il traduit un résultat de partie en transferts
 * théoriques entre joueurs. Aucun mouvement d'argent n'est exécuté ici (pas de
 * portefeuille, pas de Mobile Money, pas de prélèvement du Katika : R-09).
 */
export type PayoutKind = 'SIMPLE' | 'KORA' | 'DOUBLE_KORA';

export interface StakeTransfer {
  from: PlayerId;
  to: PlayerId;
  amount: number;
}

/**
 * Détection de la Kora et de la Double Kora. Leur déclencheur n'est pas défini
 * (R-02) : aucune implémentation n'est fournie.
 */
export interface KoraDetector {
  payoutKind(context: { winnerId: PlayerId }): PayoutKind;
}

/** Une mise est un montant entier positif ou nul ; son unité (FCFA ou jetons) reste à définir (R-13). */
export function assertValidStake(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`Mise invalide : ${amount}`);
  }
}

/**
 * Spec §5.1 « Gagné simple » : chaque perdant verse la mise au gagnant.
 * Qui compte comme perdant (fuyard compris ou non) est décidé par l'appelant (R-05).
 * Kora et Double Kora : montants connus pour une mise de 100 FCFA seulement (200 et
 * 300), sans savoir s'il s'agit de multiples ou de montants fixes (R-02).
 */
export function stakeTransfers(
  kind: PayoutKind,
  stakeAmount: number,
  winnerId: PlayerId,
  loserIds: readonly PlayerId[],
): StakeTransfer[] {
  assertValidStake(stakeAmount);
  if (kind !== 'SIMPLE') {
    throw new UnresolvedRuleError('R-02', `montant à verser en cas de ${kind} non défini`);
  }
  return loserIds
    .filter((id) => id !== winnerId)
    .map((from) => ({ from, to: winnerId, amount: stakeAmount }));
}
