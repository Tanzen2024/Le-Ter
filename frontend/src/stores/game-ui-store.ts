import { create } from 'zustand';

/**
 * État d'interface PROPRE À CHAQUE PARTIE, indexé par gameId (D-017) : jamais de
 * « partie courante ». Rien ici n'est une donnée de jeu (le serveur en est l'autorité).
 */
/**
 * Pourquoi CE téléphone ne fournit pas (encore) sa position pour une partie surveillée :
 * refus (du joueur ou du système), localisation désactivée sur le téléphone, première mesure
 * en cours, ou GPS indisponible (délai dépassé, mesure refusée). Jamais envoyé au serveur.
 */
export type LocalGpsState = 'refused' | 'services-off' | 'acquiring' | 'unavailable';

interface GameUiState {
  /** Parties dont l'animation de distribution a déjà été jouée sur cet appareil. */
  dealAnimated: Record<string, true>;
  markDealAnimated(gameId: string): void;
  /** État GPS local par partie (absent : position fournie ou pas encore demandée). */
  localGps: Record<string, LocalGpsState>;
  setLocalGps(gameId: string, state: LocalGpsState | null): void;
  /** Partie quittée : son état d'interface est oublié, celui des autres parties est conservé. */
  forgetGame(gameId: string): void;
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
  forgetGame: (gameId) =>
    set((state) => {
      if (!(gameId in state.dealAnimated) && !(gameId in state.localGps)) return state;
      const dealAnimated = { ...state.dealAnimated };
      const localGps = { ...state.localGps };
      delete dealAnimated[gameId];
      delete localGps[gameId];
      return { dealAnimated, localGps };
    }),
}));
