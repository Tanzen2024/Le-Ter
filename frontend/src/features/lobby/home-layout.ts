import type { LobbyMetrics } from './lobby-metrics';

/**
 * Gabarit de l'accueil (paysage) : titre, puis UN groupe de trois panneaux de mode (Fap-Fap,
 * Tournois, Garam Tia) de dimensions IDENTIQUES — une seule largeur et une seule hauteur pour
 * les trois, calculées ici une fois —, centré horizontalement. Tout découle de la surface
 * réellement disponible, jamais d'une résolution fixe.
 */
export interface HomeLayout {
  titleTop: number;
  titleSize: number;
  cardsTop: number;
  cardsBottom: number;
  /** Largeur commune des trois panneaux. */
  cardWidth: number;
  /** Hauteur commune des trois panneaux. */
  cardHeight: number;
  cardsGap: number;
  /** Largeur libre entre le bord de l'écran et le premier panneau de mode. */
  sideSpace: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Panneaux de l'accueil : Fap-Fap, Tournois, Garam Tia (D-119). */
export const MODE_COUNT = 3;
/** Part de la largeur utile donnée à chaque panneau. */
const CARD_WIDTH_SHARE = 0.255;
const CARD_MAX_WIDTH = 360;
/** Écart entre deux panneaux, en largeur de panneau (identique des deux côtés de Tournois). */
const CARD_GAP_RATIO = 0.15;
/** Un panneau reste au moins aussi haut que large (×1,05) : il n'est jamais écrasé. */
const MIN_HEIGHT_RATIO = 1.05;
/** Écart resserré quand les panneaux se rétrécissent pour dégager les boutons du bas. */
const COMPACT_GAP_RATIO = 0.08;
/** Rétrécissement maximal accepté pour descendre jusqu'en bas : 15 %. */
const MAX_NARROWING = 0.85;

export function computeHomeLayout(m: LobbyMetrics): HomeLayout {
  const titleSize = Math.round(clamp(m.height * 0.062, 20, 46));
  // Titre au niveau de la plaque du pseudo : il occupe le milieu de l'écran (25 % à 75 %),
  // la plaque et le solde sont dans les coins ; ils ne se croisent donc jamais.
  const titleTop = m.safe.top + m.hudBoxHeight * 0.6;
  const titleBottom = titleTop + titleSize * 1.25;
  // Le groupe commence juste sous le titre et descend jusqu'au bas de l'écran : il occupe
  // toute la hauteur disponible.
  const cardsTop = Math.round(titleBottom + m.gap * 1.5);

  const widthFor = (bottom: number) =>
    Math.round(
      Math.min(
        m.availableWidth * CARD_WIDTH_SHARE,
        CARD_MAX_WIDTH,
        (bottom - cardsTop) / MIN_HEIGHT_RATIO,
      ),
    );
  let gapRatio = CARD_GAP_RATIO;
  const gapOf = (width: number) => Math.round(width * gapRatio);
  const sideOf = (width: number) =>
    (m.width - (width * MODE_COUNT + gapOf(width) * (MODE_COUNT - 1))) / 2;

  let cardsBottom = m.height - m.safe.bottom - m.gap;
  let cardWidth = widthFor(cardsBottom);
  // Les boutons Profil / Réglages (bas gauche) ne passent jamais sous un panneau.
  const buttonsRight = m.safe.left + m.iconButton * 2 + m.gap * 2;
  if (buttonsRight > sideOf(cardWidth)) {
    // Compromis largeur / hauteur : panneaux un peu moins larges et écarts resserrés, juste
    // assez pour dégager les boutons ; le groupe descend alors jusqu'en bas. Si cela les
    // rétrécissait de plus de 15 %, ils gardent leur largeur et s'arrêtent au-dessus des
    // boutons.
    const clearWidth = Math.floor(
      (m.width - 2 * buttonsRight) / (MODE_COUNT + (MODE_COUNT - 1) * COMPACT_GAP_RATIO),
    );
    if (clearWidth >= cardWidth * MAX_NARROWING) {
      gapRatio = COMPACT_GAP_RATIO;
      cardWidth = Math.min(cardWidth, clearWidth);
    } else {
      cardsBottom = m.height - m.safe.bottom - m.iconButton - m.gap;
      cardWidth = Math.min(cardWidth, widthFor(cardsBottom));
    }
  }
  cardsBottom = Math.round(cardsBottom);
  return {
    titleTop,
    titleSize,
    cardsTop,
    cardsBottom,
    cardWidth,
    // Même hauteur pour les trois : du haut du groupe à sa limite basse.
    cardHeight: cardsBottom - cardsTop,
    cardsGap: gapOf(cardWidth),
    sideSpace: sideOf(cardWidth),
  };
}
