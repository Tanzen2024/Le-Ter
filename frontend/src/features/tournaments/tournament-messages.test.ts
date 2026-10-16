/// <reference types="jest" />
import { renderHook } from '@testing-library/react-native';

import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import { useTournamentMessages } from './tournament-messages';

const messages = async (language: 'fr' | 'en') => {
  usePreferencesStore.setState({ ...DEFAULT_PREFERENCES, language });
  return (await renderHook(() => useTournamentMessages())).result.current;
};

afterEach(() => usePreferencesStore.setState(DEFAULT_PREFERENCES));

describe('libellés des rangs récompensés', () => {
  it('français : cartes de la liste et fiche', async () => {
    const t = await messages('fr');
    expect([1, 2, 3].map(t.ranks)).toEqual([
      '🏆 1er rang récompensé',
      '🏆 2 premiers rangs récompensés',
      '🏆 3 premiers rangs récompensés',
    ]);
    expect([1, 2, 3].map(t.facts.ranks)).toEqual(['1er rang', '2 premiers rangs', '3 premiers rangs']);
  });

  it('anglais : cartes de la liste et fiche', async () => {
    const t = await messages('en');
    expect([1, 2, 3].map(t.ranks)).toEqual([
      '🏆 1st place rewarded',
      '🏆 Top 2 rewarded ranks',
      '🏆 Top 3 rewarded ranks',
    ]);
    expect([1, 2, 3].map(t.facts.ranks)).toEqual(['1st place', 'Top 2 ranks', 'Top 3 ranks']);
  });
});

describe('départage (D-109) : mêmes critères que l’administration', () => {
  it('français et anglais : parties gagnées, ordre d’inscription, identifiant', async () => {
    expect((await messages('fr')).results.tieBreakA11y).toEqual({
      GAMES_WON: 'départagé au nombre de parties gagnées',
      REGISTRATION_ORDER: 'départagé à l’ordre d’inscription',
      PLAYER_ID: 'départagé à l’identifiant du joueur',
    });
    expect((await messages('en')).results.tieBreakA11y).toEqual({
      GAMES_WON: 'tie broken by games won',
      REGISTRATION_ORDER: 'tie broken by registration order',
      PLAYER_ID: 'tie broken by player identifier',
    });
  });
});

describe('notification d’approbation (D-108)', () => {
  const approved = (preRegistered?: boolean) => ({
    id: 'n',
    type: 'TOURNAMENT_APPROVED' as const,
    payload: { ...(preRegistered && { preRegistered }) },
    createdAt: '2026-10-10T09:00:00.000Z',
  });

  it('créateur : « votre proposition » ; préinscrit : « votre préinscription est conservée »', async () => {
    const fr = await messages('fr');
    expect(fr.notification(approved())).toBe('Tournoi : votre proposition est approuvée.');
    expect(fr.notification(approved(true))).toBe(
      'Tournoi : tournoi approuvé, votre préinscription est conservée.',
    );
    const en = await messages('en');
    expect(en.notification(approved(true))).toBe(
      'Tournament: tournament approved, your pre-registration is kept.',
    );
  });
});
