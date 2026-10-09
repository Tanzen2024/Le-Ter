import { useLandscapeViewport, type LandscapeViewport } from '../../hooks/use-landscape-viewport';

/**
 * Gabarit des écrans connectés (accueil, tournois, panneaux), calculé à partir de la surface
 * paysage réellement disponible (marges de sécurité déduites), jamais d'une résolution fixe.
 * La hauteur (320 à ~1000 dp) est la dimension rare : presque tout en découle.
 */
export interface LobbyMetrics extends LandscapeViewport {
  availableWidth: number;
  availableHeight: number;
  gap: number;
  /** HUD : plaque du pseudo, compteur, jeton et solde. */
  hudBoxHeight: number;
  hudNameSize: number;
  hudCounterIcon: number;
  hudCounterSize: number;
  coinSize: number;
  balanceSize: number;
  /** Boutons carrés du bas (profil, réglages, retour) : 44 dp minimum. */
  iconButton: number;
  /** Panneaux (Profil, Réglages, Partie privée). */
  panelTitleSize: number;
  bodySize: number;
  smallSize: number;
  controlHeight: number;
  /** Cartes décoratives des côtés. */
  cardWidth: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function computeLobbyMetrics(viewport: LandscapeViewport): LobbyMetrics {
  const { width, height, safe } = viewport;
  const availableWidth = width - safe.left - safe.right;
  const availableHeight = height - safe.top - safe.bottom;
  const r = (value: number, min: number, max: number) => Math.round(clamp(value, min, max));
  return {
    ...viewport,
    availableWidth,
    availableHeight,
    gap: r(height * 0.022, 6, 16),
    hudBoxHeight: r(height * 0.1, 34, 72),
    hudNameSize: r(height * 0.046, 15, 32),
    hudCounterIcon: r(height * 0.055, 18, 40),
    hudCounterSize: r(height * 0.045, 15, 30),
    coinSize: r(height * 0.085, 32, 62),
    balanceSize: r(height * 0.066, 20, 46),
    iconButton: r(height * 0.1, 44, 72),
    panelTitleSize: r(height * 0.072, 22, 44),
    bodySize: r(height * 0.042, 13, 20),
    smallSize: r(height * 0.036, 12, 16),
    controlHeight: r(height * 0.1, 34, 52),
    cardWidth: r(height * 0.22, 56, 200),
  };
}

export function useLobbyMetrics(): LobbyMetrics {
  return computeLobbyMetrics(useLandscapeViewport());
}
