import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DecorativeCards,
  fontOf,
  PillButton,
  tablePalette,
  TatamiCard,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { useMessages } from '../../lib/i18n';
import { ComplaintNotice } from '../complaints/ComplaintNotice';
import { playSound } from '../../services/audio-service';
import { HomeTournamentSummary } from '../tournaments/HomeTournamentSummary';
import { TournamentThanksNotice } from '../tournaments/TournamentThanksNotice';
import { useLobbyMetrics, type LobbyMetrics } from './lobby-metrics';
import { LobbyShell, useLobbyPanels } from './LobbyShell';
import { ModerationNotice } from './ModerationNotice';

/**
 * Accueil connecté (paysage, D-028) : « Choisis ton mode ! » et deux modes.
 * - Parties → Rejoindre : panneau Partie privée (créer / rechercher une session).
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
      <TournamentThanksNotice />
      <ModerationNotice />
    </LobbyShell>
  );
}

interface HomeLayout {
  titleTop: number;
  titleSize: number;
  cardsTop: number;
  cardsBottom: number;
  cardWidth: number;
  cardHeight: number;
  cardsGap: number;
  /** Largeur libre entre le bord de l'écran et le premier panneau de mode. */
  sideSpace: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function computeHomeLayout(m: LobbyMetrics): HomeLayout {
  const titleSize = Math.round(clamp(m.height * 0.062, 20, 46));
  const titleTop = m.safe.top + m.hudBoxHeight + m.gap * 0.5;
  // Les petites cartes posées sur les panneaux débordent au-dessus : on leur laisse la place.
  const cardsTop = titleTop + titleSize * 1.4 + m.gap * 1.6;
  let cardsBottom = m.height - m.safe.bottom;
  const fitHeight = (bottom: number) => bottom - cardsTop;
  let cardWidth = Math.round(Math.min(m.availableWidth * 0.27, fitHeight(cardsBottom) / 1.36, 340));
  let cardsGap = Math.round(cardWidth * 0.18);
  let sideSpace = (m.width - cardWidth * 2 - cardsGap) / 2;
  // Les boutons Profil / Réglages ne doivent jamais passer sous un panneau de mode.
  const buttonsRight = m.safe.left + m.iconButton * 2 + m.gap * 2;
  if (buttonsRight > sideSpace) {
    cardsBottom -= m.iconButton + m.gap;
    cardWidth = Math.round(Math.min(cardWidth, fitHeight(cardsBottom) / 1.36));
    cardsGap = Math.round(cardWidth * 0.18);
    sideSpace = (m.width - cardWidth * 2 - cardsGap) / 2;
  }
  const cardHeight = Math.round(Math.min(cardWidth * 1.36, fitHeight(cardsBottom)));
  return {
    titleTop,
    titleSize,
    cardsTop,
    cardsBottom,
    cardWidth,
    cardHeight,
    cardsGap,
    sideSpace,
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
  const { openPanel } = useLobbyPanels();
  const t = useMessages();
  const layout = computeHomeLayout(m);
  const [appear] = useState(() => new Animated.Value(0));
  const { panel } = useLocalSearchParams<{ panel?: string }>();

  // Arrivée demandée sur la création de partie (ex. « Non merci » à la géolocalisation) :
  // le panneau s'ouvre une fois, puis le paramètre est effacé pour ne pas le rouvrir.
  useEffect(() => {
    if (panel !== 'private') return;
    openPanel('private');
    router.setParams({ panel: undefined });
  }, [panel, openPanel]);

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [appear]);

  return (
    <>
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
          icon={(size) => <PadlocksIcon size={size} />}
          accent="left"
          layout={layout}
          onJoin={() => openPanel('private')}
        />
        <ModeCard
          title={t.home.tournaments}
          icon="🏆"
          accent="right"
          layout={layout}
          onJoin={() => router.push('/tournament')}
          action={<ProposeTournamentButton width={layout.cardWidth} />}
          // Pendant le chargement, sans tournoi ou en erreur : rien (illustration seule).
          overlay={<HomeTournamentSummary width={layout.cardWidth} />}
        />
      </Animated.View>
    </>
  );
}

/**
 * Icône du panneau Parties : un cadenas ouvert et un cadenas fermé côte à côte, dans la même
 * emprise `size × size` que l'icône précédente (la mise en page du panneau ne bouge pas).
 */
function PadlocksIcon({ size }: { size: number }) {
  const fontSize = Math.round(size * 0.5);
  return (
    <View style={[styles.padlocks, { width: size, height: size }]}>
      <Text allowFontScaling={false} style={{ fontSize }}>
        🔓
      </Text>
      <Text allowFontScaling={false} style={{ fontSize }}>
        🔒
      </Text>
    </View>
  );
}

/**
 * Panneau de mode : titre gravé, icône, carte T inclinée, bouton « Rejoindre ». `action`
 * (sous le titre) et `overlay` (centré PAR-DESSUS l'illustration, en filigrane) sont
 * facultatifs : sans eux, le panneau est exactement celui d'origine. L'overlay ne déplace
 * rien : titre, bouton « Proposer » et « Rejoindre » restent à leur place et utilisables.
 */
function ModeCard({
  title,
  icon,
  accent,
  layout,
  onJoin,
  action,
  overlay,
}: {
  title: string;
  /** Emoji, ou rendu d'icône à la taille de l'illustration. */
  icon: string | ((size: number) => ReactNode);
  /** Côté de la petite carte qui déborde en haut du panneau. */
  accent: 'left' | 'right';
  layout: HomeLayout;
  onJoin: () => void;
  action?: ReactNode;
  overlay?: ReactNode;
}) {
  const fonts = useTableFonts();
  const t = useMessages();
  const { cardWidth: w, cardHeight: h } = layout;
  const pad = Math.round(w * 0.07);
  const floating = Math.round(w * 0.3);
  const inner = Math.round(w * 0.32);
  return (
    <View
      style={[
        styles.mode,
        {
          width: w,
          height: h,
          borderRadius: w * 0.08,
          padding: pad,
          gap: pad * 0.5,
        },
      ]}
    >
      <TatamiCard
        width={floating}
        fontFamily={fonts.title}
        style={[
          { top: -floating * 0.55 },
          accent === 'left'
            ? { left: w * 0.05, transform: [{ rotate: '-14deg' }] }
            : { right: w * 0.05, transform: [{ rotate: '14deg' }] },
        ]}
      />
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.modeTitle, fontOf(fonts.title), { fontSize: Math.round(w * 0.13) }]}
      >
        {title}
      </Text>
      {action}
      <View style={styles.illustration}>
        {typeof icon === 'string' ? (
          <Text allowFontScaling={false} style={{ fontSize: Math.round(w * 0.27) }}>
            {icon}
          </Text>
        ) : (
          icon(Math.round(w * 0.27))
        )}
        <View style={{ width: inner, height: inner * 1.36, marginLeft: w * 0.08 }}>
          <TatamiCard
            width={inner}
            fontFamily={fonts.title}
            style={{ top: 0, left: 0, transform: [{ rotate: '-12deg' }] }}
          />
        </View>
        {overlay ? (
          <View style={styles.overlay} pointerEvents="box-none">
            {overlay}
          </View>
        ) : null}
      </View>
      <PillButton
        title={t.home.join}
        accessibilityLabel={t.home.joinA11y(title)}
        onPress={onJoin}
        height={Math.max(44, Math.round(w * 0.2))}
        fontSize={Math.round(clamp(w * 0.095, 16, 30))}
        fontFamily={fonts.button}
      />
    </View>
  );
}

/**
 * « + Proposer un tournoi » : compact, fond vert très sombre, fine bordure et texte dorés.
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
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 1.5,
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
  mode: {
    alignItems: 'stretch',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(214, 170, 70, 0.4)',
    backgroundColor: '#0B2416',
    experimental_backgroundImage: 'linear-gradient(180deg, #0F2C1B 0%, #0A2114 60%, #081A10 100%)',
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.55)',
  },
  modeTitle: {
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 1,
    ...titleShadow,
  },
  illustration: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  padlocks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  propose: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: tablePalette.gold,
    backgroundColor: '#06170D',
  },
  proposeText: { color: tablePalette.gold, fontWeight: '700' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
