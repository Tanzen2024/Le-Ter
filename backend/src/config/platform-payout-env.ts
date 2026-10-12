import type { PayoutFeeSchedule } from '../domain/platform-finance/platform-finance';

/**
 * Retraits des revenus de la plateforme (D-078), lus à part de `readEnv` :
 *
 * - `PLATFORM_PAYOUTS_ENABLED` : `false` par défaut. Même à `true`, l'exécution exige en plus
 *   que les transferts CinetPay soient disponibles (D-077 : `CINETPAY_TRANSFERS_ENABLED`,
 *   attestation de production…) et une URL de notification dédiée. Aucun paramètre de
 *   l'interface ne peut l'activer.
 * - `PLATFORM_PAYOUT_NOTIFY_URL` : URL publique de POST /api/platform-payouts/cinetpay/notify
 *   (≤ 120 caractères, exigée si activé).
 * - `PLATFORM_PAYOUT_FEE_BPS` / `PLATFORM_PAYOUT_FEE_FIXED` : barème des frais de transfert
 *   tiré du CONTRAT CinetPay (points de base, part fixe en XAF). Absents : frais inconnus, aucun
 *   retrait ne peut être créé (jamais de barème inventé).
 */
export interface PlatformPayoutEnv {
  enabled: boolean;
  notifyUrl?: string;
  fees: PayoutFeeSchedule | null;
}

const MAX_NOTIFY_URL_LENGTH = 120;

function integer(value: string | undefined, name: string, max: number): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) > max) {
    throw new Error(`${name} invalide : entier entre 0 et ${max}`);
  }
  return Number(raw);
}

export function readPlatformPayoutEnv(source: NodeJS.ProcessEnv = process.env): PlatformPayoutEnv {
  const flag = source.PLATFORM_PAYOUTS_ENABLED?.trim().toLowerCase() || 'false';
  if (flag !== 'true' && flag !== 'false') {
    throw new Error('PLATFORM_PAYOUTS_ENABLED invalide : true ou false attendu');
  }
  const enabled = flag === 'true';

  const notifyUrl = source.PLATFORM_PAYOUT_NOTIFY_URL?.trim() || undefined;
  if (notifyUrl !== undefined) {
    let protocol: string;
    try {
      protocol = new URL(notifyUrl).protocol;
    } catch {
      throw new Error('PLATFORM_PAYOUT_NOTIFY_URL invalide : URL mal formée');
    }
    if (protocol !== 'https:' && protocol !== 'http:') {
      throw new Error('PLATFORM_PAYOUT_NOTIFY_URL invalide : http ou https attendu');
    }
    if (notifyUrl.length > MAX_NOTIFY_URL_LENGTH) {
      throw new Error(
        `PLATFORM_PAYOUT_NOTIFY_URL invalide : ${MAX_NOTIFY_URL_LENGTH} caractères maximum`,
      );
    }
  }
  if (enabled && !notifyUrl) {
    throw new Error('PLATFORM_PAYOUT_NOTIFY_URL est requis avec PLATFORM_PAYOUTS_ENABLED=true');
  }

  const bps = integer(source.PLATFORM_PAYOUT_FEE_BPS, 'PLATFORM_PAYOUT_FEE_BPS', 10_000);
  const fixed = integer(source.PLATFORM_PAYOUT_FEE_FIXED, 'PLATFORM_PAYOUT_FEE_FIXED', 100_000);
  const fees =
    bps === undefined && fixed === undefined ? null : { bps: bps ?? 0, fixed: fixed ?? 0 };

  return { enabled, ...(notifyUrl && { notifyUrl }), fees };
}
