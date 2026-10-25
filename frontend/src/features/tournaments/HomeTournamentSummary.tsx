import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { fontOf, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { gameTheme, salon } from '../../constants/theme';
import { useMessages } from '../../lib/i18n';
import { TournamentGameMarker } from '../lobby/GameIdentity';
import { useTournamentList } from './hooks';
import { StatusChip } from './TournamentDetailPanel';
import { useTournamentMessages } from './tournament-messages';
import {
  formatFcfa,
  formatTournamentSchedule,
  isParticipant,
  rewardedRanks,
  selectHomeTournament,
} from './tournament-state';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Tailles plancher (dp) : sur les plus petits téléphones, le texte ne descend jamais plus bas. */
const MIN_HEADLINE_SIZE = 11;
const MIN_META_SIZE = 9;

/**
 * Ajustement à la place RÉELLEMENT disponible (mesurée), par étapes et sans retour arrière :
 * une information par ligne ; sinon informations groupées deux à deux sur une ligne (même
 * ordre de lecture) ; sinon texte réduit jusqu'aux planchers.
 */
interface Fit {
  /** Hauteur de la zone allouée au résumé dans le panneau. */
  slot: number;
  compact: boolean;
  scale: number;
}

/**
 * Prochain tournoi pertinent de l'accueil, choisi sur la liste du SERVEUR
 * (`selectHomeTournament`) ; `undefined` pendant le chargement, sans tournoi ou en erreur.
 */
export function useHomeTournament() {
  const { data } = useTournamentList();
  return selectHomeTournament(data?.tournaments);
}

/**
 * Résumé du prochain tournoi pertinent (D-065), dans le panneau Tournois de l'accueil, à la
 * place de l'illustration (bloc à part entière entre « + Proposer un tournoi » et
 * « Rejoindre » : rien ne passe dessus ni dessous). Rien pendant le chargement, sans tournoi
 * pertinent ou en erreur.
 *
 * Ordre de lecture : jeu du tournoi (repère graphique, `TournamentGameMarker`) et statut
 * (pastille) sur une même ligne ; date ; horaire ; prix ; places ; rangs récompensés ;
 * inscription du joueur. Le bloc occupe la zone que le panneau lui alloue (il ne la dépasse
 * pas : « Rejoindre » reste à sa place) et s'y ajuste selon `Fit`.
 *
 * Un appui ouvre la fiche du tournoi (inscription, état d'affectation, rejoindre) ; le
 * bouton « Rejoindre » du panneau ouvre la liste complète.
 */
export function HomeTournamentSummary({ width: w }: { width: number }) {
  const t = useTournamentMessages();
  const home = useMessages().home;
  const fonts = useTableFonts();
  const tournament = useHomeTournament();
  const [fit, setFit] = useState<Fit>({ slot: 0, compact: false, scale: 1 });
  if (!tournament) return null;
  const { compact, scale } = fit;

  const { date, start, end } = formatTournamentSchedule(tournament);
  const headlineSize = Math.max(MIN_HEADLINE_SIZE, Math.round(clamp(w * 0.085, 13, 20) * scale));
  const metaSize = Math.max(MIN_META_SIZE, Math.round(clamp(w * 0.068, 11, 15) * scale));
  const lineHeight = (size: number) => Math.round(size * 1.25);
  const spacing = Math.max(2, Math.round(metaSize * (compact ? 0.2 : 0.3)));
  const headline = [
    styles.headline,
    fontOf(fonts.button),
    { fontSize: headlineSize, lineHeight: lineHeight(headlineSize) },
  ];
  const meta = [
    styles.meta,
    fontOf(fonts.button),
    { fontSize: metaSize, lineHeight: lineHeight(metaSize) },
  ];
  const participant = isParticipant(tournament);
  // Jeu dit aux lecteurs d'écran seulement : à l'écran, il est uniquement graphique.
  const game =
    tournament.gameType === 'TER'
      ? home.private
      : tournament.gameType === 'GARAM'
        ? home.garam
        : undefined;
  const ranks = rewardedRanks(tournament);

  // Nouvelle place (rotation, redimensionnement) : on repart de la présentation complète.
  const onSlotLayout = (event: LayoutChangeEvent) => {
    const slot = Math.round(event.nativeEvent.layout.height);
    setFit((current) => (current.slot === slot ? current : { slot, compact: false, scale: 1 }));
  };
  // Contenu plus haut que sa zone : informations groupées, puis texte réduit (jamais l'inverse).
  const onContentLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setFit((current) => {
      if (current.slot <= 0 || height <= current.slot + 1) return current;
      if (!current.compact) return { ...current, compact: true };
      const next = Math.max(0.5, (current.scale * current.slot) / height);
      return next < current.scale - 0.01 ? { ...current, scale: next } : current;
    });
  };
  const fee = t.entry(formatFcfa(tournament.entryFee));
  const players = `👥 ${tournament.registeredCount}/${tournament.minimumPlayers}`;
  const rankText = ranks > 0 ? `🏆 ${t.facts.ranks(ranks)}` : undefined;
  const registration = (
    <Text style={[meta, participant ? styles.registered : styles.notRegistered]}>
      {participant ? t.registered : t.list.notRegistered}
    </Text>
  );
  const row = (gap: number, children: ReactNode) => (
    <View style={[styles.row, { columnGap: gap }]}>{children}</View>
  );

  return (
    <View style={styles.slot} onLayout={onSlotLayout}>
      <Pressable
        testID="home-tournament-summary"
        accessibilityRole="button"
        accessibilityLabel={`${game ? `${game}, ` : ''}${t.list.open(date)}, ${t.period(start, end)}, ${
          participant ? t.registered : t.list.notRegistered
        }`}
        onPress={() => router.push(`/tournament/${tournament.tournamentId}`)}
        onLayout={onContentLayout}
        style={({ pressed }) => [
          styles.panel,
          {
            gap: spacing,
            paddingHorizontal: Math.round(metaSize * 0.5),
            paddingVertical: Math.round(metaSize * 0.5),
          },
          pressed && styles.pressed,
        ]}
      >
        {/* Repère du jeu du côté de son panneau : à gauche de la pastille pour Fap-Fap, à
            droite pour Garam Tia ; sur la ligne de la pastille, le panneau ne grandit pas. */}
        <View
          style={[
            styles.statusRow,
            { marginBottom: spacing, columnGap: metaSize * 0.5, rowGap: spacing },
          ]}
        >
          {tournament.gameType === 'TER' ? (
            <TournamentGameMarker gameType="TER" size={metaSize} />
          ) : null}
          <View style={styles.chip}>
            <StatusChip tournament={tournament} size={metaSize} fontFamily={fonts.button} fit />
          </View>
          {tournament.gameType === 'GARAM' ? (
            <TournamentGameMarker gameType="GARAM" size={metaSize} />
          ) : null}
        </View>
        {compact ? (
          <>
            {row(
              headlineSize * 0.5,
              <>
                <Text style={[headline, styles.date]}>{date}</Text>
                <Text style={headline}>{`🕐 ${t.period(start, end)}`}</Text>
              </>,
            )}
            {row(
              metaSize * 0.9,
              <>
                <Text style={meta}>{fee}</Text>
                <Text style={meta}>{players}</Text>
              </>,
            )}
            {row(
              metaSize * 0.9,
              <>
                {rankText ? <Text style={meta}>{rankText}</Text> : null}
                {registration}
              </>,
            )}
          </>
        ) : (
          <>
            <Text style={[headline, styles.date]}>{date}</Text>
            <Text style={headline}>{`🕐 ${t.period(start, end)}`}</Text>
            {row(
              metaSize * 0.9,
              <>
                <Text style={meta}>{fee}</Text>
                <Text style={meta}>{players}</Text>
              </>,
            )}
            {rankText ? <Text style={meta}>{rankText}</Text> : null}
            {registration}
          </>
        )}
      </Pressable>
    </View>
  );
}

const shadow = {
  textShadowColor: 'rgba(0, 0, 0, 0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 2,
};

const styles = StyleSheet.create({
  // Zone allouée par le panneau : le résumé y est centré verticalement.
  slot: { flex: 1, justifyContent: 'center' },
  panel: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: 'rgba(4, 9, 7, 0.9)',
    boxShadow: 'inset 0 1px 0 rgba(246, 239, 223, 0.06)',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  // Repère et pastille côte à côte si la place suffit ; sinon la pastille passe à la ligne
  // (l'ajustement `Fit` garde le résumé dans sa zone : le panneau ne change pas de taille).
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  // La pastille garde toute sa largeur : son statut n'est jamais tronqué (« … »).
  chip: { flexShrink: 0, maxWidth: '100%' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  headline: { color: salon.text, textAlign: 'center', ...shadow },
  date: { color: tablePalette.gold, letterSpacing: 0.5 },
  meta: { color: salon.textSoft, textAlign: 'center', ...shadow },
  registered: { color: tablePalette.gold },
  notRegistered: { opacity: 0.85 },
});
