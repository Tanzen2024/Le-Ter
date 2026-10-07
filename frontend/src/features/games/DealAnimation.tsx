import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/ui/Button';
import { colors, radius, spacing } from '../../constants/theme';
import type { DealBatch, GameView } from '../../types/game';
import { cardLabel, playerLabel } from './format';

/**
 * Durées de l'animation : CHOIX D'INTERFACE, pas des règles du jeu (D-032). Les règles
 * imposent seulement l'ordre (antihoraire depuis J1), les lots (3 puis 2 cartes d'un bloc) et une
 * distribution perceptible.
 */
export const DEAL_STEP_MS = 750; // intervalle entre deux lots
export const DEAL_LOT_MS = 350; // apparition d'un lot
const DEAL_END_PAUSE_MS = 900; // mains complètes visibles avant le jeu

interface DealAnimationProps {
  game: GameView;
  onDone: () => void;
}

/**
 * Rejoue VISUELLEMENT la distribution décidée par le serveur : passage 1, chaque joueur
 * reçoit un lot de 3 cartes, l'un après l'autre dans l'ordre de la table ; passage 2, un
 * lot de 2 dans le même ordre. Les cartes d'un lot apparaissent ensemble.
 *
 * L'animation n'est jamais la source de vérité : la séquence (`dealSequence`) et les mains
 * viennent de l'API. Les cartes des adversaires restent face cachée.
 */
export function DealAnimation({ game, onDone }: DealAnimationProps) {
  const play = game.play!;
  const sequence = play.dealSequence;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown < sequence.length) {
      const timer = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : DEAL_STEP_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(onDone, DEAL_END_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [shown, sequence.length, onDone]);

  const current = sequence[Math.min(shown, sequence.length) - 1];
  const caption = current
    ? `Passage ${current.pass} : ${playerLabel(game, current.playerId)} ${
        current.playerId === game.viewerId ? 'recevez' : 'reçoit'
      } ${current.count} cartes`
    : 'Distribution des cartes…';

  // Mes cartes, dans l'ordre de réception (les mains sont stockées lot par lot).
  const myLots = [play.myHand.slice(0, 3), play.myHand.slice(3, 5)];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.caption} accessibilityLiveRegion="polite">
          {caption}
        </Text>
        <View style={styles.skip}>
          <Button title="Passer" variant="link" onPress={onDone} />
        </View>
      </View>
      <View style={styles.table}>
        {play.dealOrder.map((playerId) => {
          const lots = sequence.slice(0, shown).filter((batch) => batch.playerId === playerId);
          const active = current?.playerId === playerId;
          return (
            <View key={playerId} style={[styles.seat, active && styles.seatActive]}>
              <Text style={styles.seatName}>{playerLabel(game, playerId)}</Text>
              <View style={styles.lots}>
                {lots.map((batch) => (
                  <Lot
                    key={batch.pass}
                    batch={batch}
                    faces={playerId === game.viewerId ? myLots[batch.pass - 1] : undefined}
                  />
                ))}
              </View>
              <Text style={styles.count}>{lots.reduce((total, b) => total + b.count, 0)} / 5</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Un lot : toutes ses cartes apparaissent ensemble (une seule animation pour le lot). */
function Lot({ batch, faces }: { batch: DealBatch; faces?: string[] }) {
  // Valeur animée créée une fois par lot (état paresseux : pas de lecture de ref au rendu).
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DEAL_LOT_MS,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] });
  return (
    <Animated.View
      style={[styles.lot, { opacity: progress, transform: [{ translateY }] }]}
      accessibilityLabel={`Lot de ${batch.count} cartes, passage ${batch.pass}`}
    >
      {Array.from({ length: batch.count }, (_, i) => {
        const face = faces?.[i];
        return (
          <View key={i} style={[styles.card, !face && styles.cardBack]}>
            <Text style={face ? styles.cardFace : styles.cardBackMark}>
              {face ? cardLabel(face) : 'T'}
            </Text>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  caption: { color: colors.gold, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  skip: { marginLeft: spacing.md },
  table: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  seat: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.feltLight,
    borderRadius: radius.lg,
    padding: spacing.sm,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  seatActive: { borderColor: colors.gold },
  seatName: { color: colors.textOnFelt, fontWeight: '700' },
  lots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  lot: { flexDirection: 'row', gap: 2 },
  card: {
    width: 34,
    height: 50,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBack: { backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.surface },
  cardFace: { fontSize: 12, fontWeight: '800', color: colors.text },
  cardBackMark: { color: colors.felt, fontWeight: '800' },
  count: { color: colors.textOnFelt, opacity: 0.8, fontSize: 13 },
});
