import { create } from 'zustand';

/**
 * État d'interface PROPRE À CHAQUE PARTIE, indexé par gameId (D-017) : jamais de
 * « partie courante ». Rien ici n'est une donnée de jeu (le serveur en est l'autorité).
 */
/**
 * Pourquoi CE téléphone ne fournit pas sa position pour une partie surveillée : refus (du
 * joueur ou du système) ou GPS indisponible (coupé, délai dépassé). Jamais envoyé au serveur.
 */
export type LocalGpsState = 'refused' | 'unavailable';

interface GameUiState {
  /** Parties dont l'animation de distribution a déjà été jouée sur cet appareil. */
  dealAnimated: Record<string, true>;
  markDealAnimated(gameId: string): void;
  /** État GPS local par partie (absent : position fournie ou pas encore demandée). */
  localGps: Record<string, LocalGpsState>;
  setLocalGps(gameId: string, state: LocalGpsState | null): void;
}

export const useGameUiStore = create<GameUiState>((set) => ({
  dealAnimated: {},
  markDealAnimated: (gameId) =>
    set((state) => ({ dealAnimated: { ...state.dealAnimated, [gameId]: true } })),
  localGps: {},
  setLocalGps: (gameId, value) =>
    set((state) => {
      if ((state.localGps[gameId] ?? null) === value) return state;
      const localGps = { ...state.localGps };
      if (value) localGps[gameId] = value;
      else delete localGps[gameId];
      return { localGps };
    }),
}));
