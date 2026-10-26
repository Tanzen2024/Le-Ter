/**
 * Configuration du parrainage (D-161). Aucune règle métier ici (elles sont en base, versionnées
 * par l'administration) : seulement le lien public de téléchargement et le rythme de la file.
 *
 * `REFERRAL_DOWNLOAD_URL` : page officielle de téléchargement de l'APK (https). Vide : le joueur
 * partage son code et le lien de l'application installée, jamais une adresse inventée. Le code
 * y est ajouté en paramètre `ref` ; la page doit le conserver pour l'afficher au visiteur.
 */
export interface ReferralEnv {
  downloadUrl?: string;
  tickMs: number;
  /**
   * `REFERRAL_REWARDS_ENABLED=true` : crédit des paliers (D-169). Faux par défaut tant que R-42
   * et R-34 ne sont pas tranchés : les paliers dus sont retenus, puis crédités à l'activation.
   */
  rewardsEnabled: boolean;
}

export const DEFAULT_REFERRAL_TICK_MS = 15_000;

export function readReferralEnv(source: NodeJS.ProcessEnv = process.env): ReferralEnv {
  const raw = source.REFERRAL_DOWNLOAD_URL?.trim() ?? '';
  let downloadUrl: string | undefined;
  if (raw !== '') {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('REFERRAL_DOWNLOAD_URL invalide : URL absolue attendue');
    }
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      throw new Error('REFERRAL_DOWNLOAD_URL invalide : https:// attendu');
    }
    downloadUrl = url.toString();
  }
  const tick = Number(source.REFERRAL_TICK_MS ?? DEFAULT_REFERRAL_TICK_MS);
  if (!Number.isInteger(tick) || tick < 1000 || tick > 3_600_000) {
    throw new Error('REFERRAL_TICK_MS invalide : entier entre 1000 et 3600000 attendu');
  }
  const rawRewards = source.REFERRAL_REWARDS_ENABLED?.trim() ?? '';
  if (rawRewards !== '' && rawRewards !== 'true' && rawRewards !== 'false') {
    throw new Error('REFERRAL_REWARDS_ENABLED invalide : true ou false attendu');
  }
  return { ...(downloadUrl && { downloadUrl }), tickMs: tick, rewardsEnabled: rawRewards === 'true' };
}
