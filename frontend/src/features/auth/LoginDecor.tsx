import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';

import { DecorativeCards, TatamiCard } from '../../components/table/TableDecor';

/**
 * Décor des écrans Connexion et Inscription : les 5 cartes L E T E R au-dessus du titre, et
 * l'ambiance du fond (reflet bordeaux, halo doré, étoiles scintillantes, 3 cartes Le Ter de
 * chaque côté). Purement graphique : rien n'est cliquable ni annoncé aux lecteurs d'écran.
 */

const LETTERS = ['L', 'E', 'T', 'E', 'R'] as const;
/** Éventail : inclinaison et léger abaissement des cartes extérieures. */
const FAN = [
  { rotate: -14, drop: 0.1 },
  { rotate: -7, drop: 0.03 },
  { rotate: 0, drop: 0 },
  { rotate: 7, drop: 0.03 },
  { rotate: 14, drop: 0.1 },
] as const;
const CARD_RATIO = 1.36;

/** Largeur occupée par l'éventail des 5 cartes d'une hauteur donnée. */
export function leterCardsSize(cardHeight: number) {
  const width = cardHeight / CARD_RATIO;
  const step = width * 0.78;
  return { cardWidth: width, step, width: width + step * 4, height: cardHeight * 1.14 };
}

/** Les 5 cartes du nom LETER, une lettre centrée par carte. */
export function LeterCards({
  cardHeight,
  fontFamily,
}: {
  cardHeight: number;
  fontFamily?: string;
}) {
  const { cardWidth, step, width, height } = leterCardsSize(cardHeight);
  return (
    <View
      style={[styles.passThrough, { width, height }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="LETER"
    >
      {LETTERS.map((letter, index) => (
        <TatamiCard
          key={index}
          width={cardWidth}
          letter={letter}
          medallionRatio={0.74}
          fontFamily={fontFamily}
          style={{
            left: index * step,
            top: cardHeight * FAN[index]!.drop,
            zIndex: index === 2 ? 3 : index === 1 || index === 3 ? 2 : 1,
            transform: [{ rotate: `${FAN[index]!.rotate}deg` }],
          }}
        />
      ))}
    </View>
  );
}

/** Étoiles, réparties sur les côtés (jamais derrière les champs) : position en fraction d'écran. */
const STARS = [
  { x: 0.05, y: 0.16, size: 3, period: 2600, delay: 0 },
  { x: 0.16, y: 0.08, size: 2, period: 3200, delay: 900 },
  { x: 0.24, y: 0.3, size: 2.5, period: 2800, delay: 400 },
  { x: 0.09, y: 0.46, size: 2, period: 3600, delay: 1500 },
  { x: 0.2, y: 0.58, size: 3, period: 3000, delay: 700 },
  { x: 0.95, y: 0.14, size: 3, period: 2900, delay: 300 },
  { x: 0.84, y: 0.07, size: 2, period: 3400, delay: 1200 },
  { x: 0.77, y: 0.32, size: 2.5, period: 2700, delay: 600 },
  { x: 0.91, y: 0.44, size: 2, period: 3300, delay: 1800 },
  { x: 0.8, y: 0.6, size: 3, period: 3100, delay: 200 },
] as const;

/** Largeur libre minimale de chaque côté pour poser les cartes sans toucher le panneau. */
const MIN_SIDE_SPACE = 64;

/**
 * Fond décoré, sous le panneau. Les cartes latérales ne s'affichent que s'il reste assez de
 * place de chaque côté du panneau (téléphone étroit + panneau large : aucune carte).
 */
export function LoginBackdropDecor({
  width,
  height,
  panelWidth,
  fontFamily,
}: {
  width: number;
  height: number;
  panelWidth: number;
  fontFamily?: string;
}) {
  const sideSpace = (width - panelWidth) / 2;
  const cardWidth = Math.round(
    Math.min(190, Math.max(40, Math.min(height * 0.21, sideSpace * 0.58))),
  );
  const halo = Math.round(Math.max(width, height) * 0.9);
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.passThrough]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.glow,
          { width: halo, height: halo, borderRadius: halo / 2, left: (width - halo) / 2 },
          { top: (height - halo) / 2 },
        ]}
      />
      <View
        style={[
          styles.arc,
          {
            width: halo,
            height: halo,
            borderRadius: halo / 2,
            left: (width - halo) / 2,
            top: height * 0.62,
          },
        ]}
      />
      {STARS.map((star, index) => (
        <Star key={index} {...star} left={star.x * width} top={star.y * height} />
      ))}
      {sideSpace >= MIN_SIDE_SPACE ? (
        <DecorativeCards cardWidth={cardWidth} sideSpace={sideSpace} fontFamily={fontFamily} />
      ) : null}
    </View>
  );
}

/** Scintillement lent ; fixe si l'utilisateur a demandé de réduire les animations. */
function Star({
  left,
  top,
  size,
  period,
  delay,
}: {
  left: number;
  top: number;
  size: number;
  period: number;
  delay: number;
}) {
  const [opacity] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    let cancelled = false;
    let loop: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => true)
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(opacity, { toValue: 1, duration: period / 2, useNativeDriver: true }),
            Animated.timing(opacity, {
              toValue: 0.2,
              duration: period / 2,
              useNativeDriver: true,
            }),
          ]),
        );
        loop.start();
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [delay, opacity, period]);
  return (
    <Animated.View
      style={[
        styles.star,
        {
          left,
          top,
          width: size,
          height: size,
          borderRadius: size / 2,
          boxShadow: `0 0 ${size * 3}px ${size}px rgba(255, 196, 90, 0.55)`,
          opacity,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'none' },
  // Reflet bordeaux / marron chaud derrière le panneau.
  glow: {
    position: 'absolute',
    experimental_backgroundImage:
      'radial-gradient(closest-side, rgba(168, 58, 22, 0.42) 0%, rgba(110, 26, 14, 0.28) 45%, rgba(60, 10, 6, 0) 100%)',
  },
  // Halo doré : grand arc fin sous le panneau.
  arc: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(242, 196, 81, 0.22)',
    boxShadow: '0 0 24px 2px rgba(242, 160, 60, 0.18)',
  },
  star: { position: 'absolute', backgroundColor: '#FFE7A8' },
});
