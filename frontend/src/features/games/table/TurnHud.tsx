import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  fontOf,
  tablePalette as palette,
  useTableFonts,
} from '../../../components/table/TableDecor';
import { useServerRemainingMs } from '../../../hooks/use-server-countdown';
import { playSound } from '../../../services/audio-service';
import type { GameView } from '../../../types/game';
import { INSTANT_WIN_LABELS, playerLabel } from '../format';
import type { GameTableLayout } from './table-layout';
import { DEFAULT_TURN_MS, TURN_SIGNAL_MS, useReducedMotion } from './turn-signal';

/**
 * Indicateurs de tour de la table (bas gauche) et actions ponctuelles (bas droit), placés
 * comme sur la table de référence. Aucun minuteur métier ici : le chrono lit l'échéance du
 * tour FIXÉE PAR LE SERVEUR (D-034) et les boutons n'existent que si le serveur les autorise.
 */

const RING_SEGMENTS = 48;

/** Arc de progression dessiné en segments (aucune dépendance SVG). */
function CountdownRing({
  size,
  fraction,
  color,
}: {
  size: number;
  /** Part du tour restante, de 0 à 1. */
  fraction: number;
  color: string;
}) {
  const thickness = Math.max(3, size * 0.09);
  const radius = (size - thickness) / 2;
  const segment = ((2 * Math.PI * radius) / RING_SEGMENTS) * 0.9;
  const lit = Math.round(Math.min(1, Math.max(0, fraction)) * RING_SEGMENTS);
  return (
    <View style={[StyleSheet.absoluteFill, styles.passThrough]}>
      {Array.from({ length: RING_SEGMENTS }, (_, i) => {
        const angle = (i / RING_SEGMENTS) * 2 * Math.PI;
        return (
          <View
            key={i}
            style={[
              styles.segment,
              {
                width: segment,
                height: thickness,
                borderRadius: thickness / 2,
                left: size / 2 + radius * Math.sin(angle) - segment / 2,
                top: size / 2 - radius * Math.cos(angle) - thickness / 2,
                backgroundColor: i < lit ? color : 'rgba(0, 0, 0, 0.35)',
                transform: [{ rotate: `${(i * 360) / RING_SEGMENTS}deg` }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/** Texte du bandeau de tour, uniquement à partir de l'état synchronisé. */
export function turnMessage(
  game: GameView,
  { dealing, lastTrick }: { dealing: boolean; lastTrick: boolean },
): string | null {
  if (lastTrick) return '5ᵉ tour : cartes jouées automatiquement';
  if (game.status !== 'in_progress' || !game.play) return null;
  if (dealing) return 'Distribution des cartes…';
  if (game.turnTimedOutAt) return 'Temps écoulé : coup automatique';
  const active = game.activePlayerId ?? game.play.nextPlayerId;
  if (!active) return null;
  return active === game.viewerId ? "C'est ton tour !" : `Tour de ${playerLabel(game, active)}`;
}

/**
 * Bas gauche : chrono circulaire du joueur attendu (secondes restantes selon le serveur),
 * « Tour n/5 » dessous (en entier, jamais tronqué) et bandeau « C'est ton tour ! » / « Tour de <pseudo> ».
 */
export function TurnHud({
  game,
  receivedAt,
  layout,
  dealing,
  presenting,
  safeLeft,
  safeBottom,
}: {
  game: GameView;
  receivedAt: number;
  layout: GameTableLayout;
  dealing: boolean;
  presenting: boolean;
  safeLeft: number;
  safeBottom: number;
}) {
  const fonts = useTableFonts();
  const running = game.status === 'in_progress' && !dealing && !game.turnTimedOutAt;
  const remainingMs = useServerRemainingMs(
    running ? game.turnDeadlineAt : undefined,
    game.serverNow,
    receivedAt,
  );
  // 5e tour : joué par le système, aucun compte à rebours (D-041).
  const lastTrick = game.status === 'finished' && presenting;
  if ((game.status !== 'in_progress' && !lastTrick) || !game.play) return null;

  const { ring, columnWidth, labelHeight, labelFontSize, message } = layout.hud;
  const totalMs =
    game.turnDeadlineAt && game.turnStartedAt
      ? Date.parse(game.turnDeadlineAt) - Date.parse(game.turnStartedAt)
      : DEFAULT_TURN_MS;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const fraction = remainingMs === null ? (lastTrick || dealing ? 1 : 0) : remainingMs / totalMs;
  const urgent = seconds !== null && seconds <= 3;
  const myTurn = (game.activePlayerId ?? game.play.nextPlayerId) === game.viewerId;
  const text = turnMessage(game, { dealing, lastTrick });
  const trick = lastTrick ? 5 : game.play.trickNumber;

  return (
    <>
      <View
        style={[
          styles.absolute,
          styles.passThrough,
          styles.column,
          {
            left: safeLeft,
            bottom: safeBottom,
            width: columnWidth,
            gap: layout.gap * 0.5,
          },
        ]}
      >
        <View
          accessible
          accessibilityLabel={
            seconds === null ? 'Chrono du tour' : `${seconds} seconde${seconds > 1 ? 's' : ''}`
          }
          style={[styles.ring, { width: ring, height: ring, borderRadius: ring / 2 }]}
        >
          <View
            style={[
              styles.ringDisc,
              {
                width: ring * 0.74,
                height: ring * 0.74,
                borderRadius: ring * 0.37,
              },
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[styles.ringText, fontOf(fonts.button), { fontSize: ring * 0.4 }]}
            >
              {seconds ?? '–'}
            </Text>
          </View>
          <CountdownRing size={ring} fraction={fraction} color={urgent ? '#F0524F' : '#F5D23C'} />
        </View>
        {/* Toute la largeur de la colonne, dimensionnée pour « Tour 5/5 » ; si une police
            plus large que prévu dépasse, le texte rétrécit au lieu d'être coupé. */}
        <View
          testID="turn-counter"
          style={[
            styles.label,
            {
              width: columnWidth,
              height: labelHeight,
              paddingHorizontal: labelHeight * 0.4,
            },
          ]}
        >
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.labelText, fontOf(fonts.button), { fontSize: labelFontSize }]}
          >
            Tour {trick}/5
          </Text>
        </View>
      </View>
      {text ? (
        <View
          style={[
            styles.absolute,
            styles.passThrough,
            styles.message,
            myTurn && !dealing && !lastTrick && styles.messageMine,
            {
              left: message.left,
              bottom: message.bottom,
              width: message.width,
              minHeight: message.height,
            },
          ]}
        >
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={2}
            style={[styles.messageText, fontOf(fonts.button), { fontSize: message.height * 0.34 }]}
          >
            {text}
          </Text>
        </View>
      ) : null}
    </>
  );
}

/**
 * Signal lumineux posé sur les cartes encore en main du joueur qui devient actif : apparaît,
 * pulse une fois, s'éteint en 2 s. Monté une fois par tour (clé = tour), retiré par
 * `useTurnSignal` ; avec « réduire les animations », halo fixe sans mouvement.
 */
export function TurnGlow({
  rect,
}: {
  rect: { left: number; top: number; width: number; height: number };
}) {
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    const step = TURN_SIGNAL_MS / 8;
    const animation = Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: step,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0.5,
        duration: step * 2,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: step * 2,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: step * 3,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [opacity, reduced]);
  const pad = 6;
  return (
    <Animated.View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.absolute,
        styles.passThrough,
        styles.glow,
        {
          left: rect.left - pad,
          top: rect.top - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          opacity,
        },
      ]}
    />
  );
}

/**
 * Bas droit : « Se coucher » (= la fuite du tour 1, commande FLEE, D-035) et « Gagner »
 * (victoire instantanée, DECLARE_WIN), chacun affiché SEULEMENT si le serveur l'autorise
 * (`myActions`). Le résultat affiché vient toujours de la vue serveur confirmée.
 */
export function TurnActions({
  game,
  layout,
  pending,
  onFlee,
  onDeclareWin,
  safeRight,
  safeBottom,
}: {
  game: GameView;
  layout: GameTableLayout;
  pending: boolean;
  onFlee: () => void;
  onDeclareWin: () => void;
  safeRight: number;
  safeBottom: number;
}) {
  const fonts = useTableFonts();
  const { canFlee, canDeclareInstantWin } = game.myActions;
  if (!canFlee && !canDeclareInstantWin) return null;
  const size = layout.action.size;
  const press = (action: () => void) => () => {
    playSound('uiClick');
    action();
  };
  return (
    <View
      style={[
        styles.absolute,
        styles.actions,
        {
          right: safeRight,
          bottom: safeBottom,
          gap: layout.gap * 0.6,
          width: size * 1.3,
        },
      ]}
    >
      {canDeclareInstantWin ? (
        <Pressable
          onPress={press(onDeclareWin)}
          disabled={pending}
          accessibilityRole="button"
          accessibilityLabel={`Gagner instantanément${
            game.myInstantWin ? ` : ${INSTANT_WIN_LABELS[game.myInstantWin.combination]}` : ''
          }`}
          accessibilityState={{ disabled: pending, busy: pending }}
          style={({ pressed }) => [
            styles.winButton,
            {
              minHeight: size * 0.5,
              borderRadius: size * 0.16,
              paddingHorizontal: size * 0.1,
            },
            pressed && styles.pressed,
            pending && styles.disabled,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.winText, fontOf(fonts.button), { fontSize: size * 0.2 }]}
          >
            Gagner
          </Text>
          {game.myInstantWin ? (
            <Text
              numberOfLines={1}
              style={[styles.winHint, { fontSize: Math.max(10, size * 0.13) }]}
            >
              {INSTANT_WIN_LABELS[game.myInstantWin.combination]} (rang {game.myInstantWin.rank})
            </Text>
          ) : null}
        </Pressable>
      ) : null}
      {canFlee ? (
        <Pressable
          onPress={press(onFlee)}
          disabled={pending}
          accessibilityRole="button"
          accessibilityLabel="Se coucher : abandonner cette partie (fuite du 1er tour)"
          accessibilityState={{ disabled: pending, busy: pending }}
          style={({ pressed }) => [
            styles.foldButton,
            { width: size, height: size, borderRadius: size * 0.26 },
            pressed && styles.pressed,
            pending && styles.disabled,
          ]}
        >
          <Text allowFontScaling={false} style={{ fontSize: size * 0.42 }}>
            ✋
          </Text>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.foldText, fontOf(fonts.button), { fontSize: size * 0.15 }]}
          >
            Se coucher
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
  passThrough: { pointerEvents: 'none' },
  column: { alignItems: 'center' },
  segment: { position: 'absolute' },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0E5A2E',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.35)',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.45)',
  },
  ringDisc: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#127A3C',
    experimental_backgroundImage: 'radial-gradient(circle at 50% 35%, #1FA352 0%, #0F6B33 100%)',
  },
  ringText: { color: '#FFFFFF', includeFontPadding: false },
  label: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: 'rgba(6, 30, 14, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  labelText: { color: '#FFFFFF', includeFontPadding: false },
  message: {
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(6, 30, 14, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.35)',
  },
  messageMine: { borderColor: 'rgba(242, 196, 81, 0.8)' },
  messageText: { color: '#FFFFFF', textAlign: 'center' },
  glow: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 224, 120, 0.95)',
    backgroundColor: 'rgba(255, 214, 90, 0.16)',
    boxShadow: '0 0 18px 6px rgba(255, 206, 70, 0.65)',
  },
  actions: { alignItems: 'flex-end' },
  foldButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C8242C',
    experimental_backgroundImage: 'linear-gradient(180deg, #E8423F 0%, #B0161F 100%)',
    borderWidth: 2,
    borderColor: 'rgba(255, 200, 190, 0.6)',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.45)',
  },
  foldText: { color: '#FFFFFF', includeFontPadding: false, marginTop: -2 },
  winButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.goldDeep,
    experimental_backgroundImage: 'linear-gradient(180deg, #FFD65C 0%, #D9961F 100%)',
    borderWidth: 1.5,
    borderColor: '#7A4A10',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.45)',
  },
  winText: { color: '#3E2205', includeFontPadding: false },
  winHint: { color: '#4A2A08' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.55 },
});
