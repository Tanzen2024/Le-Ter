import { api } from '@/lib/api/client';
import type { GameCommissionSettings, GameCommissionTier } from '@/types/admin';

/**
 * Barème de commission des parties ordinaires (D-074). Le serveur reste l'unique autorité :
 * ce module ne fait qu'une prévalidation ergonomique (les mêmes règles que le serveur, qui
 * revalide tout) et une simulation INDICATIVE. Aucun montant réel n'est calculé ici.
 */

export const gameCommissionQuery = () => ({
  queryKey: ['admin', 'game-commission'] as const,
  queryFn: () => api.get<GameCommissionSettings>('settings/game-commission'),
});

export function saveGameCommission(tiers: GameCommissionTier[]) {
  return api.patch<GameCommissionSettings>('settings/game-commission', { tiers });
}

/**
 * Ligne en cours d'édition : mise minimale, plafond et taux saisis par l'administrateur. La
 * prévalidation reprend les règles du serveur : la première tranche commence à 1, chaque
 * tranche commence juste après le plafond de la précédente (ni trou, ni chevauchement), la
 * dernière est toujours sans plafond.
 */
export interface DraftTier {
  key: string;
  minStake: string;
  /** Plafond saisi ; ignoré pour la dernière tranche. */
  maxStake: string;
  percent: string;
}

export interface DraftRowView {
  key: string;
  minStake: string;
  maxStake: string;
  percent: string;
  last: boolean;
  errors: { minStake?: string; maxStake?: string; percent?: string };
}

let sequence = 0;
const nextKey = () => `t${++sequence}`;

/** « 1,5 » ou « 1.5 » → 1.5 ; null si la saisie n'est pas un nombre décimal. */
function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Entier positif sûr, ou null. */
function parseInteger(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

const formatPercentInput = (p: number) => String(p).replace('.', ',');

export function toDraft(tiers: GameCommissionTier[]): DraftTier[] {
  return tiers.map((t) => ({
    key: nextKey(),
    minStake: String(t.minStake),
    maxStake: t.maxStake === null ? '' : String(t.maxStake),
    percent: formatPercentInput(t.percent),
  }));
}

/** Nouvelle tranche à la fin : l'ancienne dernière reçoit un plafond à saisir. */
export function addTier(draft: DraftTier[]): DraftTier[] {
  const last = draft.at(-1);
  return [...draft, { key: nextKey(), minStake: '', maxStake: '', percent: last?.percent ?? '0' }];
}

export function removeTier(draft: DraftTier[], key: string): DraftTier[] {
  return draft.length <= 1 ? draft : draft.filter((t) => t.key !== key);
}

export function updateTier(
  draft: DraftTier[],
  key: string,
  patch: Partial<Pick<DraftTier, 'minStake' | 'maxStake' | 'percent'>>,
): DraftTier[] {
  return draft.map((t) => (t.key === key ? { ...t, ...patch } : t));
}

/**
 * Erreurs de prévalidation de chaque ligne, et barème prêt à envoyer s'il n'y en a aucune.
 * Le serveur revalide tout : ces messages ne servent qu'à corriger avant l'envoi.
 */
export function validateDraft(
  draft: DraftTier[],
  limits: { min: number; max: number },
  maxTiers: number,
): { rows: DraftRowView[]; tiers: GameCommissionTier[] | null; formError: string | null } {
  const rows: DraftRowView[] = [];
  const tiers: GameCommissionTier[] = [];
  /** Plafond de la tranche précédente ; null s'il est invalide (continuité non jugée). */
  let previousMax: number | null = 0;
  let valid = true;
  draft.forEach((t, index) => {
    const last = index === draft.length - 1;
    const errors: DraftRowView['errors'] = {};

    const min = parseInteger(t.minStake);
    if (min === null || min < 1) {
      errors.minStake = 'Mise minimale entière attendue (au moins 1).';
    } else if (index === 0 && min !== 1) {
      errors.minStake = 'La première tranche commence à 1.';
    } else if (index > 0 && previousMax !== null && min !== previousMax + 1) {
      const expected = previousMax + 1;
      errors.minStake =
        min > expected
          ? `Trou : les mises de ${expected} à ${min - 1} n’ont pas de tranche. Attendu : ${expected}.`
          : `Chevauchement avec la tranche précédente (jusqu’à ${previousMax}). Attendu : ${expected}.`;
    }

    let max: number | null = null;
    if (!last) {
      max = parseInteger(t.maxStake);
      if (max === null) {
        errors.maxStake = 'Mise maximale entière attendue.';
      } else if (min !== null && max < min) {
        errors.maxStake = `Au moins ${min} (mise minimale de la tranche).`;
        max = null;
      }
    }

    const percent = parseDecimal(t.percent);
    if (
      percent === null ||
      percent < limits.min ||
      percent > limits.max ||
      Math.abs(percent * 100 - Math.round(percent * 100)) > 1e-9
    ) {
      errors.percent = `Taux entre ${limits.min} et ${limits.max} %, deux décimales au plus.`;
    }

    rows.push({
      key: t.key,
      minStake: t.minStake,
      maxStake: t.maxStake,
      percent: t.percent,
      last,
      errors,
    });
    if (errors.minStake || errors.maxStake || errors.percent) valid = false;
    else tiers.push({ minStake: min as number, maxStake: max, percent: percent as number });
    previousMax = max;
  });
  let formError: string | null = null;
  if (draft.length === 0) formError = 'Le barème doit contenir au moins une tranche.';
  else if (draft.length > maxTiers) formError = `Barème limité à ${maxTiers} tranches.`;
  return { rows, tiers: valid && !formError ? tiers : null, formError };
}

/** Deux barèmes identiques (mêmes bornes, mêmes taux). */
export function sameSchedule(a: GameCommissionTier[], b: GameCommissionTier[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (t, i) =>
        t.minStake === b[i]!.minStake &&
        t.maxStake === b[i]!.maxStake &&
        Math.round(t.percent * 100) === Math.round(b[i]!.percent * 100),
    )
  );
}

export type VictoryType = 'SIMPLE' | 'KORA';

export interface Simulation {
  tier: GameCommissionTier;
  /** Taux appliqué (%) : celui de la tranche, Kora comprise (D-080). */
  appliedPercent: number;
  /** Mise perdue par chaque perdant : M ou 2M. */
  lossPerLoser: number;
  losers: number;
  /** Somme des mises des perdants : base de la commission, redistribuée au gagnant. */
  redistributed: number;
  commission: number;
  /** Ce que le gagnant reçoit : redistribué − commission (il garde aussi sa propre mise). */
  netGain: number;
  /** Disponible exigé de chaque joueur pour démarrer : 2 × la mise. */
  requiredBalance: number;
}

/**
 * Simulation INDICATIVE d'un règlement (D-074) : le résultat officiel est celui du serveur.
 * Commission = floor(mises des perdants × taux appliqué), en points de base entiers.
 * Précondition : barème valide, mise entière ≥ 1, 2 à 4 joueurs.
 */
export function simulate(
  tiers: GameCommissionTier[],
  input: { stake: number; players: number; victory: VictoryType; koraLossMultiplier: number },
): Simulation | null {
  const { stake, players, victory, koraLossMultiplier } = input;
  if (!Number.isSafeInteger(stake) || stake < 1 || players < 2) return null;
  const tier = tiers.find(
    (t) => stake >= t.minStake && (t.maxStake === null || stake <= t.maxStake),
  );
  if (!tier) return null;
  const tierBps = Math.round(tier.percent * 100);
  // Kora : seule la perte (base de la commission) est multipliée, jamais le taux (D-080).
  const appliedBps = tierBps;
  const lossPerLoser = victory === 'KORA' ? koraLossMultiplier * stake : stake;
  const losers = players - 1;
  const redistributed = lossPerLoser * losers;
  const commission = Math.floor((redistributed * appliedBps) / 10_000);
  return {
    tier,
    appliedPercent: appliedBps / 100,
    lossPerLoser,
    losers,
    redistributed,
    commission,
    netGain: redistributed - commission,
    requiredBalance: koraLossMultiplier * stake,
  };
}
