import { useLanguage } from '../../lib/i18n';
import type { Language } from '../../stores/preferences-store';
import type { RefereeStatus } from '../../types/referral';

/** Textes de la section Parrainage d'« Assistance » (D-161), en français et en anglais. */
const fr = {
  tab: 'Parrainage',
  title: 'Invitez vos amis, gagnez des jetons',
  intro: (perTier: number, threshold: string, reward: string) =>
    `Chaque groupe de ${perTier} filleuls qualifiés vous rapporte ${reward}. Un filleul est qualifié lorsque SES recharges confirmées atteignent ${threshold} sur son propre compte.`,
  code: 'Votre code personnel',
  copy: 'Copier le code',
  copied: 'Code copié',
  share: 'Partager l’invitation',
  inviteLink: 'Lien d’invitation',
  noDownloadLink:
    'Lien de téléchargement non configuré : partagez votre code, votre ami le saisira à l’inscription.',
  manualHint:
    'Après avoir installé l’application depuis le lien, votre ami doit saisir votre code dans « Code de parrainage » avant de créer son compte.',
  shareMessage: (code: string, invite: string | null) =>
    `Rejoins-moi sur Le Ter ! ${invite ? `Télécharge l’application : ${invite}\n` : ''}À l’inscription, saisis mon code de parrainage : ${code}`,
  suspended:
    'Programme suspendu : aucune nouvelle inscription par code pour le moment. Vos récompenses acquises sont conservées ; les paliers atteints seront crédités à la reprise.',
  withheld: (n: number) => `${n} palier(s) atteint(s) en attente de crédit (reprise du programme).`,
  pending: 'Une recharge confirmée est en cours de prise en compte.',
  stats: {
    attributed: 'Filleuls inscrits',
    qualified: 'Filleuls qualifiés',
    tiers: 'Paliers atteints',
    credited: 'Jetons crédités',
  },
  next: (remaining: number, reward: string, tier: number) =>
    remaining === 0
      ? `Palier ${tier} atteint : crédit de ${reward} en cours.`
      : `Encore ${remaining} filleul(s) qualifié(s) pour le palier ${tier} : +${reward}.`,
  allTiers: 'Tous les paliers de la campagne sont atteints. Merci !',
  referees: 'Vos filleuls',
  empty: 'Aucun filleul pour le moment. Partagez votre code pour commencer !',
  progress: (progress: string, threshold: string) => `${progress} / ${threshold} de recharges confirmées`,
  statuses: {
    IN_PROGRESS: 'En cours',
    QUALIFIED: 'Qualifié',
    UNDER_REVIEW: 'En vérification',
    NOT_COUNTED: 'Non compté',
  } satisfies Record<RefereeStatus, string>,
  rewards: 'Récompenses créditées',
  reward: (tier: number, amount: string) => `Palier ${tier} : +${amount}`,
  notice: (amount: string) => `🎁 Parrainage : ${amount} crédités sur votre compte de jeu.`,
  tokens: (n: number) => `${n.toLocaleString('fr-FR')} jetons`,
  retry: 'Réessayer',
  locale: 'fr-FR',
};

export type ReferralMessages = typeof fr;

const en: ReferralMessages = {
  tab: 'Referrals',
  title: 'Invite your friends, earn tokens',
  intro: (perTier, threshold, reward) =>
    `Every group of ${perTier} qualified referrals earns you ${reward}. A referral qualifies once THEIR confirmed top-ups reach ${threshold} on their own account.`,
  code: 'Your personal code',
  copy: 'Copy code',
  copied: 'Code copied',
  share: 'Share invitation',
  inviteLink: 'Invitation link',
  noDownloadLink:
    'Download link not configured: share your code, your friend will enter it when signing up.',
  manualHint:
    'After installing the app from the link, your friend must enter your code in “Referral code” before creating their account.',
  shareMessage: (code, invite) =>
    `Join me on Le Ter! ${invite ? `Download the app: ${invite}\n` : ''}When signing up, enter my referral code: ${code}`,
  suspended:
    'Programme suspended: no new sign-ups with a code for now. Rewards already earned are kept; tiers reached will be credited when it resumes.',
  withheld: (n) => `${n} tier(s) reached, waiting to be credited (programme resuming).`,
  pending: 'A confirmed top-up is being taken into account.',
  stats: {
    attributed: 'Signed-up referrals',
    qualified: 'Qualified referrals',
    tiers: 'Tiers reached',
    credited: 'Tokens credited',
  },
  next: (remaining, reward, tier) =>
    remaining === 0
      ? `Tier ${tier} reached: ${reward} being credited.`
      : `${remaining} more qualified referral(s) for tier ${tier}: +${reward}.`,
  allTiers: 'All campaign tiers reached. Thank you!',
  referees: 'Your referrals',
  empty: 'No referrals yet. Share your code to get started!',
  progress: (progress, threshold) => `${progress} / ${threshold} of confirmed top-ups`,
  statuses: {
    IN_PROGRESS: 'In progress',
    QUALIFIED: 'Qualified',
    UNDER_REVIEW: 'Under review',
    NOT_COUNTED: 'Not counted',
  },
  rewards: 'Rewards credited',
  reward: (tier, amount) => `Tier ${tier}: +${amount}`,
  notice: (amount) => `🎁 Referrals: ${amount} credited to your game account.`,
  tokens: (n) => `${n.toLocaleString('en-GB')} tokens`,
  retry: 'Retry',
  locale: 'en-GB',
};

const MESSAGES: Record<Language, ReferralMessages> = { fr, en };

export function useReferralMessages(): ReferralMessages {
  return MESSAGES[useLanguage()] ?? fr;
}
