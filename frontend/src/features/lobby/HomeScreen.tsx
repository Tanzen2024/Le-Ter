import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DecorativeCards,
  fontOf,
  PillButton,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { gameTheme, salon } from '../../constants/theme';
import { useMessages } from '../../lib/i18n';
import { ComplaintNotice } from '../complaints/ComplaintNotice';
import { ReferralNotice } from '../referrals/ReferralNotice';
import { playSound } from '../../services/audio-service';
import type { GameType } from '../../types/session';
import { useOpenTableCount } from '../sessions/hooks';
import { HomeTournamentSummary, useHomeTournament } from '../tournaments/HomeTournamentSummary';
import { TournamentThanksNotice } from '../tournaments/TournamentThanksNotice';
import { useReducedMotion } from '../games/table/turn-signal';
import { GameIdentityIcon, TournamentEmblem } from './GameIdentity';
import { computeHomeLayout, type HomeLayout } from './home-layout';
import { useLobbyMetrics } from './lobby-metrics';
import { LobbyShell, useLobbyPanels } from './LobbyShell';
import { ModerationNotice } from './ModerationNotice';

/**
 * Accueil connecté (paysage, D-028) : « Choisis ton mode ! » et trois panneaux.
 * - Fap-Fap → Rejoindre : panneau Partie privée (créer / rechercher une session).
 * - Garam Tia → Rejoindre : le même panneau, pour les parties de GARAM TIA (D-119).
 * - Tournois → Rejoindre : écran Tournois (route /tournament).
 * - Tournois → « + Proposer un tournoi » : parcours de proposition existant
 *   (route /tournament/propose) ; au centre du panneau, en filigrane, le résumé compact du
 *   prochain tournoi pertinent choisi parmi la liste du serveur (D-065), qui ouvre sa fiche.
 * Le panneau Parties est inchangé.
 */
export function HomeScreen() {
  return (
    <LobbyShell decor={<HomeDecor />}>
      <ModeSelect />
      <ComplaintNotice />
      <ReferralNotice />
      <TournamentThanksNotice />
      <ModerationNotice />
    </LobbyShell>
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Mesures internes d'un panneau de mode. */
function modeCardMetrics(w: number, screenHeight: number) {
  const pad = Math.round(w * 0.07);
  return {
    pad,
    gap: pad * 0.5,
    titleSize: Math.round(w * 0.13),
    /** Espace de part et d'autre du résumé du tournoi (resserré sur les écrans bas). */
    bodySpacing: Math.round(pad * (screenHeight < 400 ? 0.25 : 0.5)),
    // « Rejoindre » compact : 34 dp minimum (téléphones), zone d'appui élargie de 8 dp en haut
    // et en bas (50 dp au doigt) ; tablette et ordinateur inchangés.
    joinHeight: Math.max(34, Math.round(w * 0.15)),
    joinFontSize: Math.round(clamp(w * 0.08, 14, 24)),
  };
}

function HomeDecor() {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { sideSpace } = computeHomeLayout(m);
  return (
    <DecorativeCards
      cardWidth={Math.round(Math.min(m.height * 0.3, sideSpace * 0.8, 220))}
      sideSpace={sideSpace}
      fontFamily={fonts.title}
    />
  );
}

function ModeSelect() {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  // Panneau ouvert (Profil, Réglages…) : il est seul au premier plan, le titre s'efface.
  const { openPanel, panel: openedPanel } = useLobbyPanels();
  const t = useMessages();
  const layout = computeHomeLayout(m);
  const homeTournament = useHomeTournament();
  const [appear] = useState(() => new Animated.Value(0));
  const { panel } = useLocalSearchParams<{ panel?: string }>();
  const reduced = useReducedMotion();

  // Arrivée demandée sur la création de partie (ex. « Non merci » à la géolocalisation) :
  // le panneau s'ouvre une fois, puis le paramètre est effacé pour ne pas le rouvrir.
  useEffect(() => {
    if (panel !== 'private') return;
    openPanel('private');
    router.setParams({ panel: undefined });
  }, [panel, openPanel]);

  useEffect(() => {
    if (reduced) {
      appear.setValue(1);
      return;
    }
    Animated.timing(appear, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [appear, reduced]);

  return (
    <>
      {openedPanel ? null : (
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            styles.title,
            fontOf(fonts.title),
            {
              top: layout.titleTop,
              fontSize: layout.titleSize,
              left: m.width * 0.25,
              right: m.width * 0.25,
            },
          ]}
        >
          {t.home.chooseMode}
        </Text>
      )}
      <Animated.View
        style={[
          styles.cards,
          {
            top: layout.cardsTop,
            height: layout.cardsBottom - layout.cardsTop,
            gap: layout.cardsGap,
            // Fondu seul, comme les tournois : les cartes apparaissent à leur place finale,
            // sans glissement concurrent de la transition de navigation.
            opacity: appear,
          },
        ]}
      >
        <ModeCard
          title={t.home.private}
          emblem={<GameIdentityIcon gameType="TER" />}
          layout={layout}
          onJoin={() => openPanel('private')}
          footer={<OpenGamesCount gameType="TER" width={layout.cardWidth} />}
        />
        <ModeCard
          title={t.home.tournaments}
          emblem={<TournamentEmblem />}
          layout={layout}
          onJoin={() => router.push('/tournament')}
          action={<ProposeTournamentButton width={layout.cardWidth} />}
          // Pendant le chargement, sans tournoi ou en erreur : l'emblème seul. Avec un tournoi,
          // son résumé porte l'emblème de SON jeu (`gameType`, TournamentGameMarker).
          body={homeTournament ? <HomeTournamentSummary width={layout.cardWidth} /> : undefined}
        />
        <ModeCard
          title={t.home.garam}
          emblem={<GameIdentityIcon gameType="GARAM" />}
          layout={layout}
          onJoin={() => openPanel('garam')}
          footer={<OpenGamesCount gameType="GARAM" width={layout.cardWidth} />}
        />
      </Animated.View>
    </>
  );
}

/**
 * Panneau de mode : titre gravé, emblème, bouton « Rejoindre ». Facultatifs :
 * `action` (sous le titre), `body` (bloc qui PREND LA PLACE de l'emblème, dans le flux :
 * rien ne le chevauche) et `footer` (juste au-dessus de « Rejoindre »). Les trois panneaux
 * ont toujours la même hauteur (`layout.cardHeight`).
 */
function ModeCard({
  title,
  emblem,
  layout,
  onJoin,
  action,
  body,
  footer,
}: {
  title: string;
  /** Emblème permanent du panneau (GameIdentity), qui remplit sa zone. */
  emblem: ReactNode;
  layout: HomeLayout;
  onJoin: () => void;
  action?: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
}) {
  const fonts = useTableFonts();
  const t = useMessages();
  const m = useLobbyMetrics();
  const { cardWidth: w, cardHeight: h } = layout;
  const c = modeCardMetrics(w, m.height);
  return (
    <View
      style={[
        styles.mode,
        {
          width: w,
          height: h,
          borderRadius: w * 0.08,
          padding: c.pad,
          // Panneau à résumé (Tournois) : espacements internes resserrés pour que tout le
          // résumé tienne entre « Proposer » et « Rejoindre ». Mêmes marges en haut et en bas
          // que les autres panneaux : titres et boutons « Rejoindre » restent alignés.
          gap: body ? Math.round(c.gap * 0.4) : c.gap,
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.modeTitle, fontOf(fonts.title), { fontSize: c.titleSize }]}
      >
        {title}
      </Text>
      <View style={styles.modeRule} accessibilityElementsHidden importantForAccessibility="no" />
      {action}
      {body ? (
        <View style={[styles.body, { marginVertical: Math.round(c.bodySpacing * 0.5) }]}>
          {body}
        </View>
      ) : (
        <View
          style={styles.illustration}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {/* Carré centré : toute la hauteur libre, jamais plus large que le panneau. */}
          <View style={[styles.emblem, { maxHeight: Math.round(w * 0.62) }]}>{emblem}</View>
        </View>
      )}
      {footer}
      <PillButton
        title={t.home.join}
        accessibilityLabel={t.home.joinA11y(title)}
        onPress={onJoin}
        // Compact : la place gagnée revient au contenu ; appui confortable grâce au hitSlop.
        height={c.joinHeight}
        fontSize={c.joinFontSize}
        fontFamily={fonts.button}
        hitSlop={{ top: 8, bottom: 8 }}
        style={styles.join}
      />
    </View>
  );
}

/**
 * Nombre de parties à rejoindre du jeu du panneau (Fap-Fap → TER, Garam Tia → GARAM) : la
 * liste « Rechercher une partie » du serveur, même filtre. Affiché aussi à 0 ; rien tant
 * que la réponse n'est pas arrivée ou en erreur (jamais un chiffre inventé).
 */
function OpenGamesCount({ gameType, width: w }: { gameType: GameType; width: number }) {
  const fonts = useTableFonts();
  const t = useMessages();
  const { data: count } = useOpenTableCount(gameType);
  if (count === undefined) return null;
  const fontSize = Math.round(clamp(w * 0.068, 11, 16));
  return (
    <View
      testID={`open-games-${gameType}`}
      style={[
        styles.openGames,
        {
          paddingHorizontal: fontSize * 0.7,
          paddingVertical: 2,
          borderRadius: fontSize,
        },
      ]}
    >
      <Text numberOfLines={1} style={[styles.openGamesText, fontOf(fonts.button), { fontSize }]}>
        {`🃏 ${t.home.openGames(count)}`}
      </Text>
    </View>
  );
}

/**
 * « + Proposer un tournoi » : compact, laque sombre, filet et texte de laiton.
 * Ouvre le parcours de proposition EXISTANT (aucune seconde logique de création).
 */
function ProposeTournamentButton({ width: w }: { width: number }) {
  const fonts = useTableFonts();
  const t = useMessages();
  const height = Math.round(clamp(w * 0.12, 26, 44));
  const fontSize = Math.round(clamp(w * 0.05, 11, 18));
  return (
    <Pressable
      onPress={() => {
        router.push('/tournament/propose');
        playSound('uiClick');
      }}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole="button"
      accessibilityLabel={t.home.proposeTournament}
      style={({ pressed }) => [
        styles.propose,
        {
          height,
          borderRadius: height / 2,
          paddingHorizontal: height * 0.5,
          gap: height * 0.2,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.proposeText, fontOf(fonts.button), { fontSize: fontSize * 1.3 }]}>
        +
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.proposeText, fontOf(fonts.button), { fontSize, flexShrink: 1 }]}
      >
        {t.home.proposeTournament}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    position: 'absolute',
    // Au-dessus des petites cartes qui débordent en haut des panneaux (Tournois).
    zIndex: 1,
    color: salon.text,
    textAlign: 'center',
    letterSpacing: 2,
    ...titleShadow,
  },
  cards: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Plaque de laque à filet de laiton, éclairée par le haut comme la table.
  mode: {
    alignItems: 'stretch',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: salon.surface.fill,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(31, 52, 44, 0.97) 0%, rgba(13, 24, 20, 0.97) 46%, rgba(7, 13, 11, 0.98) 100%)',
    boxShadow: `${gameTheme.shadow.panel}, inset 0 1px 0 rgba(246, 239, 223, 0.08)`,
  },
  modeTitle: {
    color: salon.text,
    textAlign: 'center',
    letterSpacing: 1.4,
    ...titleShadow,
  },
  modeRule: {
    height: 1,
    marginHorizontal: '12%',
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(214, 178, 94, 0) 0%, rgba(214, 178, 94, 0.7) 50%, rgba(214, 178, 94, 0) 100%)',
  },
  illustration: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblem: { height: '100%', aspectRatio: 1, maxWidth: '100%' },
  propose: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: 'rgba(214, 178, 94, 0.08)',
  },
  proposeText: { color: salon.brass.text, fontWeight: '700' },
  openGames: {
    alignSelf: 'center',
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: salon.surface.wellBorder,
    // Fond sombre : lisible même si la carte T inclinée de l'illustration déborde dessous.
    backgroundColor: 'rgba(4, 9, 7, 0.82)',
  },
  openGamesText: { color: salon.textSoft },
  pressed: { opacity: 0.86, transform: [{ scale: 0.96 }] },
  // Zone BORNÉE entre « Proposer » et « Rejoindre » : son contenu ne la fait jamais grandir
  // (le résumé s'y ajuste), le bouton reste au bas du panneau.
  body: { flex: 1, minHeight: 0, alignItems: 'stretch' },
  join: { width: '88%', alignSelf: 'center' },
});
