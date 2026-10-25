/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Share } from 'react-native';

import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import type { ReferralProgram } from '../../types/referral';
import { useMarkNotificationRead, useNotifications } from '../tournaments/hooks';
import { useReferralProgram } from './hooks';
import { ReferralNotice } from './ReferralNotice';
import { ReferralSection } from './ReferralSection';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('./hooks', () => ({ useReferralProgram: jest.fn() }));
jest.mock('../tournaments/hooks', () => ({
  useNotifications: jest.fn(),
  useMarkNotificationRead: jest.fn(),
}));

/** Section Parrainage d'« Assistance » (D-161) : affiche ce que renvoie le serveur, rien d'autre. */

const PROGRAM: ReferralProgram = {
  campaign: {
    status: 'ACTIVE',
    rules: { version: 1, referralsPerTier: 10, qualificationThreshold: 1000, rewardPerTier: 5000, maxTiers: null },
    updatedAt: '2026-10-20T08:00:00Z',
  },
  code: 'K7M9P2QR',
  links: { invite: 'https://le-ter.example/telecharger?ref=K7M9P2QR', app: 'leter://register?ref=K7M9P2QR' },
  summary: { attributed: 0, qualified: 0, counted: 0, tiersReached: 0, tokensCredited: 0 },
  nextTier: { tier: 1, referralsRequired: 10, remaining: 10, reward: 5000 },
  withheldTiers: 0,
  evaluationPending: false,
  referees: [],
  rewards: [],
};

const program = (data: ReferralProgram) =>
  (useReferralProgram as jest.Mock).mockReturnValue({ isPending: false, error: null, data, refetch: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  usePreferencesStore.setState({ ...DEFAULT_PREFERENCES, language: 'fr' });
});

describe('section Parrainage', () => {
  it('avant le premier filleul : code, copie, partage, lien et état vide (24, 25)', async () => {
    program(PROGRAM);
    await render(<ReferralSection />);
    expect(screen.getByTestId('referral-code')).toHaveTextContent('K7M9P2QR');
    expect(screen.getByText('Aucun filleul pour le moment. Partagez votre code pour commencer !')).toBeTruthy();
    expect(screen.getByText('Encore 10 filleul(s) qualifié(s) pour le palier 1 : +5 000 jetons.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Copier le code'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('K7M9P2QR');
    expect(await screen.findByText('Code copié')).toBeTruthy();

    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await fireEvent.press(screen.getByText('Partager l’invitation'));
    const message = share.mock.calls[0]![0] as { message: string };
    expect(message.message).toContain('https://le-ter.example/telecharger?ref=K7M9P2QR');
    expect(message.message).toContain('K7M9P2QR');
  });

  it('sans lien configuré : aucun lien inventé, code seul', async () => {
    program({ ...PROGRAM, links: { invite: null, app: 'leter://register?ref=K7M9P2QR' } });
    await render(<ReferralSection />);
    expect(screen.getByText(/Lien de téléchargement non configuré/)).toBeTruthy();
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await fireEvent.press(screen.getByText('Partager l’invitation'));
    expect((share.mock.calls[0]![0] as { message: string }).message).not.toMatch(/https?:/);
  });

  it('après des paliers : progression individuelle, récompenses, section toujours présente (26, 27, 28)', async () => {
    program({
      ...PROGRAM,
      summary: { attributed: 22, qualified: 21, counted: 21, tiersReached: 2, tokensCredited: 10000 },
      nextTier: { tier: 3, referralsRequired: 30, remaining: 9, reward: 5000 },
      referees: [
        { id: 'a1', username: 'awa_1', attributedAt: '2026-10-10T08:00:00Z', progress: 1000, threshold: 1000, status: 'QUALIFIED', qualifiedAt: '2026-10-11T08:00:00Z' },
        { id: 'a2', username: 'ben_2', attributedAt: '2026-10-10T08:00:00Z', progress: 600, threshold: 1000, status: 'IN_PROGRESS', qualifiedAt: null },
      ],
      rewards: [
        { tier: 1, amount: 5000, creditedAt: '2026-10-12T08:00:00Z' },
        { tier: 2, amount: 5000, creditedAt: '2026-10-18T08:00:00Z' },
      ],
    });
    await render(<ReferralSection />);
    expect(screen.getByTestId('referral-code')).toBeTruthy();
    expect(screen.getByText('10 000 jetons')).toBeTruthy();
    expect(screen.getByText('Qualifié')).toBeTruthy();
    expect(screen.getByText('En cours')).toBeTruthy();
    // Chaque filleul : sa propre barre vers 1 000 jetons.
    expect(screen.getByText('600 jetons / 1 000 jetons de recharges confirmées')).toBeTruthy();
    expect(screen.getByLabelText('600 jetons / 1 000 jetons de recharges confirmées').props.accessibilityValue).toEqual({
      min: 0,
      max: 1000,
      now: 600,
    });
    expect(screen.getByText('Encore 9 filleul(s) qualifié(s) pour le palier 3 : +5 000 jetons.')).toBeTruthy();
    expect(screen.getByText('Récompenses créditées')).toBeTruthy();
    expect(screen.getAllByText(/Palier \d : \+5 000 jetons/)).toHaveLength(2);
  });

  it('campagne suspendue : section visible avec un état explicatif (31)', async () => {
    program({ ...PROGRAM, campaign: { ...PROGRAM.campaign, status: 'SUSPENDED' }, withheldTiers: 1 });
    await render(<ReferralSection />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Programme suspendu/);
    expect(screen.getByText(/1 palier\(s\) atteint\(s\) en attente de crédit/)).toBeTruthy();
    expect(screen.getByTestId('referral-code')).toBeTruthy();
  });
});

describe('bandeau de récompense', () => {
  const mutate = jest.fn();
  beforeEach(() => (useMarkNotificationRead as jest.Mock).mockReturnValue({ mutate }));

  it('montre un crédit confirmé par le serveur, puis le marque lu à l’ouverture', async () => {
    (useNotifications as jest.Mock).mockReturnValue({
      data: {
        notifications: [{ id: 'n1', type: 'REFERRAL_REWARD_CREDITED', payload: { amount: 5000, tier: 1 } }],
      },
    });
    await render(<ReferralNotice />);
    await fireEvent.press(screen.getByText('🎁 Parrainage : 5 000 jetons crédités sur votre compte de jeu.'));
    expect(mutate).toHaveBeenCalledWith('n1');
    expect(router.push).toHaveBeenCalledWith('/support?tab=referral');
  });

  it('une notification déjà lue ne réapparaît pas', async () => {
    (useNotifications as jest.Mock).mockReturnValue({
      data: {
        notifications: [
          { id: 'n1', type: 'REFERRAL_REWARD_CREDITED', payload: { amount: 5000 }, readAt: '2026-10-20T08:00:00Z' },
        ],
      },
    });
    await render(<ReferralNotice />);
    expect(screen.queryByTestId('referral-notice')).toBeNull();
  });
});
