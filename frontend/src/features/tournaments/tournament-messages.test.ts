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
