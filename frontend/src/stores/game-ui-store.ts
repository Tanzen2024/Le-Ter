import { create } from 'zustand';

/**
 * État d'interface PROPRE À CHAQUE PARTIE, indexé par gameId (D-017) : jamais de
 * « partie courante ». Rien ici n'est une donnée de jeu (le serveur en est l'autorité).
 */
interface GameUiState {
  /** Parties dont l'animation de distribution a déjà été jouée sur cet appareil. */
  dealAnimated: Record<string, true>;
  markDealAnimated(gameId: string): void;
}

export const useGameUiStore = create<GameUiState>((set) => ({
  dealAnimated: {},
  markDealAnimated: (gameId) =>
    set((state) => ({ dealAnimated: { ...state.dealAnimated, [gameId]: true } })),
}));
