import { readReferralEnv } from '../../../src/config/referral-env';
import type { ReferralRepository } from '../../../src/repositories/referral.repository';
import { ReferralService } from '../../../src/services/referrals/referral.service';
import { createLogger } from '../../../src/utils/logger';

/**
 * Lien de téléchargement du parrainage (D-161) : jamais fabriqué. Sans `REFERRAL_DOWNLOAD_URL`,
 * seul le lien de l'application installée (schéma `leter`) est proposé.
 */
const service = (downloadUrl?: string) =>
  new ReferralService({
    repository: {} as ReferralRepository,
    logger: createLogger({}, () => undefined),
    ...(downloadUrl && { downloadUrl }),
    appScheme: 'leter',
  });

describe('REFERRAL_DOWNLOAD_URL', () => {
  it('absente ou vide : aucun lien de téléchargement', () => {
    expect(readReferralEnv({}).downloadUrl).toBeUndefined();
    expect(readReferralEnv({ REFERRAL_DOWNLOAD_URL: '   ' }).downloadUrl).toBeUndefined();
    expect(service().links('K7M9P2QR')).toEqual({
      invite: null,
      app: 'leter://register?ref=K7M9P2QR',
    });
  });

  it('configurée en https : le code est ajouté en paramètre ref', () => {
    const env = readReferralEnv({ REFERRAL_DOWNLOAD_URL: 'https://telechargement.example/apk' });
    expect(service(env.downloadUrl).links('K7M9P2QR').invite).toBe(
      'https://telechargement.example/apk?ref=K7M9P2QR',
    );
  });

  it('refuse une adresse non https ou mal formée (démarrage bloqué, jamais un lien douteux)', () => {
    expect(() => readReferralEnv({ REFERRAL_DOWNLOAD_URL: 'http://telechargement.example/apk' })).toThrow(
      /https/,
    );
    expect(() => readReferralEnv({ REFERRAL_DOWNLOAD_URL: 'pas une url' })).toThrow(/invalide/);
  });
});

describe('REFERRAL_REWARDS_ENABLED (D-169)', () => {
  it('absente ou vide : crédit des paliers désactivé (défaut prudent)', () => {
    expect(readReferralEnv({}).rewardsEnabled).toBe(false);
    expect(readReferralEnv({ REFERRAL_REWARDS_ENABLED: ' ' }).rewardsEnabled).toBe(false);
    expect(readReferralEnv({ REFERRAL_REWARDS_ENABLED: 'false' }).rewardsEnabled).toBe(false);
  });

  it('true active le crédit ; toute autre valeur bloque le démarrage', () => {
    expect(readReferralEnv({ REFERRAL_REWARDS_ENABLED: 'true' }).rewardsEnabled).toBe(true);
    for (const value of ['1', 'yes', 'TRUE', 'oui']) {
      expect(() => readReferralEnv({ REFERRAL_REWARDS_ENABLED: value })).toThrow(/REFERRAL_REWARDS_ENABLED/);
    }
  });
});
