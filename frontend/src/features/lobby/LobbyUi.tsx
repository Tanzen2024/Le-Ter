import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  BRAND_INITIAL,
  fontOf,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { ExclusiveOverlay } from '../../components/ui/ExclusiveOverlay';
import { gameTheme, salon } from '../../constants/theme';
import { useMessages } from '../../lib/i18n';
import { keyboardAvoidingBehavior } from '../../lib/keyboard';
import { playSound, type SoundName } from '../../services/audio-service';
import { useReducedMotion } from '../games/table/turn-signal';
import { useWallet } from '../wallet/hooks';
import { useLobbyMetrics } from './lobby-metrics';

/**
 * Briques des écrans connectés : HUD, boutons carrés, cadre de panneau, petits boutons.
 * Toutes reposent sur la palette et les polices de la table (components/table/TableDecor).
 */

/** Fonction prévue par la maquette mais sans API à ce jour : on l'annonce, sans rien simuler. */
export function announceComingSoon(title: string, message: string) {
  Alert.alert(title, message);
}

/** Valeur non fournie par le serveur : jamais de chiffre inventé. */
const UNAVAILABLE = '—';

/** Solde RÉEL du compte de jeu (serveur), « — » tant qu'il n'est pas connu. */
/**
 * Solde affiché : le DISPONIBLE (solde − réservé, D-054) ; les fonds bloqués sont indiqués à
 * part (`reserved`, 🔒), jamais additionnés. Ils viennent des inscriptions à des tournois :
 * RÉSERVÉS, pas débités. Une partie en cours ne change ni le solde ni le disponible (D-080) ;
 * seul le règlement de fin de partie débite un perdant.
 */
export function useBalanceLabel(): { text: string; label: string; reserved?: string } {
  const wallet = useWallet();
  const t = useMessages();
  if (!wallet.data) return { text: UNAVAILABLE, label: t.lobby.balanceUnavailable };
  const reserved = wallet.data.reserved ?? 0;
  const available = wallet.data.available ?? wallet.data.balance - reserved;
  return reserved > 0
    ? {
        text: String(available),
        label: t.lobby.balanceWithReserved(available, reserved),
        reserved: `🔒 ${reserved}`,
      }
    : { text: String(available), label: t.lobby.balance(available) };
}

/**
 * Emprise horizontale du HUD (pseudo à gauche, solde à droite), mesurée par `LobbyShell` : un
 * panneau ouvert reste entre les deux, le HUD toujours visible au-dessus de lui (D-133).
 * Hors de la coquille (table de jeu…) : aucune emprise, panneaux inchangés.
 */
export const HudInsetsContext = createContext<{ left: number; right: number }>({
  left: 0,
  right: 0,
});

export function LobbyHud({
  username,
  playerNumber,
  onAddCoins,
  inert = false,
  onInsets,
}: {
  username?: string;
  /** Numéro d'ordre du joueur sur la plateforme (D-133) ; absent : « — ». */
  playerNumber?: number;
  onAddCoins: () => void;
  /** Panneau ouvert : HUD affiché mais NON interactif (seul le panneau l'est, D-126). */
  inert?: boolean;
  /** Emprise mesurée : bord droit du bloc gauche, distance du bloc droit au bord droit. */
  onInsets?: (insets: { left?: number; right?: number }) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const balance = useBalanceLabel();
  const t = useMessages();
  const numbered = typeof playerNumber === 'number' && Number.isSafeInteger(playerNumber);
  return (
    <>
      <View
        testID="hud-left"
        onLayout={(e) => {
          const { x, width } = e.nativeEvent.layout;
          onInsets?.({ left: Math.ceil(x + width) });
        }}
        style={[styles.hudLeft, { top: m.safe.top, left: m.safe.left, gap: m.gap * 0.6 }]}
      >
        <View
          style={[
            styles.nameBox,
            { height: m.hudBoxHeight, paddingHorizontal: m.hudBoxHeight * 0.3 },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.name,
              fontOf(fonts.title),
              { fontSize: m.hudNameSize, maxWidth: Math.min(260, m.width * 0.2) },
            ]}
          >
            {username ?? ' '}
          </Text>
        </View>
        {/* Numéro d'ordre du joueur sur la plateforme (D-133), lu sur le compte du serveur. */}
        <View
          testID="hud-player-number"
          style={[styles.row, { gap: m.gap * 0.8, paddingLeft: m.hudBoxHeight * 0.1 }]}
          accessible
          accessibilityLabel={
            numbered ? t.lobby.playerNumberA11y(playerNumber) : t.lobby.counterUnavailable
          }
        >
          <Text allowFontScaling={false} style={{ fontSize: m.hudCounterIcon }}>
            🧑
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.counter, fontOf(fonts.button), { fontSize: m.hudCounterSize }]}
          >
            {numbered ? t.lobby.playerNumber(playerNumber) : UNAVAILABLE}
          </Text>
        </View>
      </View>

      <View
        testID="hud-right"
        onLayout={(e) => onInsets?.({ right: Math.ceil(m.width - e.nativeEvent.layout.x) })}
        style={[
          styles.row,
          styles.hudRight,
          { top: m.safe.top, right: m.safe.right + m.gap, gap: m.gap * 1.4 },
        ]}
      >
        <Pressable
          onPress={onAddCoins}
          disabled={inert}
          accessibilityRole="button"
          accessibilityLabel={t.lobby.addCoins}
          accessibilityState={{ disabled: inert }}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Coin size={m.coinSize} fontFamily={fonts.title} />
          <View
            style={[
              styles.plus,
              {
                width: m.coinSize * 0.42,
                height: m.coinSize * 0.42,
                borderRadius: m.coinSize * 0.21,
                top: -m.coinSize * 0.12,
                right: -m.coinSize * 0.14,
              },
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[styles.plusText, { fontSize: m.coinSize * 0.34 }]}
            >
              +
            </Text>
          </View>
        </Pressable>
        {/* Largeur minimale réservée : l'arrivée du solde (« — » → montant) ne déplace ni le
            jeton ni l'emprise du HUD, donc ni les panneaux ouverts (D-133). */}
        <View
          accessible
          accessibilityLabel={balance.label}
          style={[styles.balanceColumn, { minWidth: Math.round(m.balanceSize * 2.2) }]}
        >
          <Text style={[styles.balance, fontOf(fonts.title), { fontSize: m.balanceSize }]}>
            {balance.text}
          </Text>
          {balance.reserved ? (
            <Text
              testID="hud-reserved"
              style={[styles.reserved, fontOf(fonts.button), { fontSize: m.smallSize }]}
            >
              {balance.reserved}
            </Text>
          ) : null}
        </View>
      </View>
    </>
  );
}

/** Jeton « L » en laiton frappé (monnaie du jeu), le même sur la table et autour d'elle. */
export function Coin({ size, fontFamily }: { size: number; fontFamily?: string }) {
  return (
    <View
      style={[
        styles.coin,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: Math.max(2, size * 0.08),
        },
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[styles.coinLetter, { fontSize: size * 0.5, fontFamily }]}
      >
        {BRAND_INITIAL}
      </Text>
    </View>
  );
}

/** Bouton carré arrondi du bas d'écran : laque à filet de laiton, sang-de-bœuf pour le retour. */
export function IconButton({
  label,
  onPress,
  tone = 'teal',
  children,
}: {
  label: string;
  onPress: () => void;
  tone?: 'teal' | 'danger';
  children: ReactNode;
}) {
  const { iconButton: size } = useLobbyMetrics();
  return (
    <Pressable
      onPress={() => {
        onPress();
        playSound('uiClick');
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        tone === 'danger' && styles.iconButtonDanger,
        { width: size, height: size, borderRadius: size * 0.2 },
        pressed && styles.pressedButton,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function EmojiIcon({ children }: { children: string }) {
  const { iconButton } = useLobbyMetrics();
  return (
    <Text allowFontScaling={false} style={{ fontSize: iconButton * 0.48 }}>
      {children}
    </Text>
  );
}

/** Flèche du bouton retour. */
export function BackGlyph() {
  const { iconButton } = useLobbyMetrics();
  return (
    <Text allowFontScaling={false} style={[styles.backGlyph, { fontSize: iconButton * 0.62 }]}>
      ←
    </Text>
  );
}

/**
 * Panneau superposé (Profil, Réglages, Partie privée) : seul visible (D-126), laque sombre à
 * filet de laiton, titre ivoire centré souligné d'un filet, bouton de fermeture rond. Le bouton retour Android et un appui hors du
 * panneau le ferment. Le contenu défile si la hauteur manque (petits smartphones).
 */
export function LobbyPanel({
  title,
  onClose,
  width,
  below,
  footer,
  closeLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Nom accessible du bouton X (par défaut « Fermer », traduit). */
  closeLabel?: string;
  /** Largeur souhaitée, plafonnée par la largeur disponible. */
  width: number;
  /** Plaque affichée sous le panneau (liens légaux des Réglages). */
  below?: ReactNode;
  /**
   * Zone d'actions du panneau (Enregistrer, Proposer, Déconnexion…) : posée SOUS le contenu
   * défilant, séparée par un filet, toujours visible, même clavier ouvert (le contenu se réduit
   * au-dessus d'elle, jamais elle).
   */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const t = useMessages();
  const closeName = closeLabel ?? t.common.close;
  const [appear] = useState(() => new Animated.Value(0));
  const reduced = useReducedMotion();

  useEffect(() => {
    // « Réduire les animations » : le panneau est aussitôt à sa place, sans zoom.
    if (reduced) {
      appear.setValue(1);
      return;
    }
    Animated.timing(appear, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [appear, reduced]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const close = Math.max(40, Math.round(m.panelTitleSize * 1.15));
  const padding = Math.round(m.gap * 1.2);
  // HUD de la coquille toujours visible (D-133) : le panneau, centré, reste entre ses deux blocs.
  const hud = useContext(HudInsetsContext);
  const side =
    hud.left > 0 || hud.right > 0
      ? Math.max(m.safe.left, m.safe.right, hud.left + m.gap * 0.5, hud.right + m.gap * 0.5)
      : undefined;
  return (
    <ExclusiveOverlay
      style={{
        paddingTop: m.safe.top,
        paddingBottom: m.safe.bottom,
        paddingLeft: side ?? m.safe.left,
        paddingRight: side ?? m.safe.right,
      }}
    >
      {/* Clavier ouvert (formulaires : proposer un tournoi, mot de passe…) : le panneau se
          réduit au-dessus du clavier et son contenu défile jusqu'au dernier champ, au lieu de
          passer sous le clavier (`keyboardAvoidingBehavior`, D-132). */}
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior}
        style={styles.keyboardArea}
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              width: Math.min(width, side === undefined ? m.availableWidth : m.width - side * 2),
              maxHeight: m.availableHeight - (below ? m.controlHeight + m.gap : 0),
              padding,
              opacity: appear,
              transform: [
                {
                  scale: appear.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.94, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[
              styles.panelTitle,
              fontOf(fonts.button),
              {
                fontSize: m.panelTitleSize,
                marginHorizontal: close + 4,
                marginBottom: m.gap * 0.5,
              },
            ]}
          >
            {title}
          </Text>
          <View
            style={[styles.titleRule, { marginBottom: m.gap * 0.8 }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <ScrollView
            style={styles.shrink}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            // Barre visible (permanente sur Android) : un formulaire plus haut que l'écran
            // montre qu'il continue, ses boutons du bas ne passent jamais inaperçus.
            showsVerticalScrollIndicator
            persistentScrollbar
            bounces={false}
          >
            {children}
          </ScrollView>
          {footer ? (
            <View
              testID="panel-actions"
              style={[styles.footer, { marginTop: m.gap * 0.6, paddingTop: m.gap * 0.6 }]}
            >
              {footer}
            </View>
          ) : null}
          {/* Bouton X déclaré APRÈS le contenu (et `elevation`) : au premier plan pour le
            toucher aussi, sur Android le contenu défilant ne capte jamais son appui. */}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={closeName}
            hitSlop={8}
            style={({ pressed }) => [
              styles.close,
              { width: close, height: close, top: padding, right: padding },
              pressed && styles.pressedButton,
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[styles.closeText, { fontSize: Math.round(close * 0.42) }]}
            >
              ✕
            </Text>
          </Pressable>
        </Animated.View>
        {below ? (
          <Animated.View style={{ opacity: appear, marginTop: m.gap * 0.6 }}>{below}</Animated.View>
        ) : null}
      </KeyboardAvoidingView>
    </ExclusiveOverlay>
  );
}

/** Cadre intérieur sombre d'un panneau. */
export function InnerFrame({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { gap } = useLobbyMetrics();
  return <View style={[styles.inner, { padding: gap }, style]}>{children}</View>;
}

/**
 * Petit bouton des panneaux : laque émeraude (action), sang-de-bœuf (départ, refus) ou laiton
 * plein (option choisie d'un groupe).
 */
export function PanelButton({
  title,
  onPress,
  tone = 'jade',
  selected,
  disabled = false,
  loading = false,
  accessibilityLabel,
  sound = 'uiClick',
  compact = false,
}: {
  title: string;
  onPress: () => void;
  /**
   * `primary` : action principale d'un écran (émeraude, filet et lueur de laiton) ;
   * `quiet` : action secondaire d'une zone d'actions (creux sombre, filet émeraude).
   */
  tone?: 'jade' | 'danger' | 'primary' | 'quiet';
  /** Version resserrée (panneau Réglages tenu sans défilement en paysage). */
  compact?: boolean;
  /** Son joué après l'action (si le son est activé à ce moment-là). */
  sound?: SoundName;
  /** Option d'un groupe (ON/OFF, langues) : l'option choisie est dorée. */
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const inactive = disabled || loading;
  const height = compact
    ? Math.max(32, Math.round(m.controlHeight * 0.78))
    : Math.max(36, Math.round(m.controlHeight * 0.9));
  return (
    <Pressable
      onPress={() => {
        // Son APRÈS l'action : appuyer sur OFF est déjà silencieux, ON se fait entendre.
        onPress();
        playSound(sound);
      }}
      disabled={inactive}
      hitSlop={4}
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading, selected }}
      style={({ pressed }) => [
        styles.panelButton,
        tone === 'danger' && styles.panelButtonDanger,
        tone === 'primary' && styles.panelButtonPrimary,
        tone === 'quiet' && styles.panelButtonQuiet,
        selected && styles.panelButtonSelected,
        { height, paddingHorizontal: height * 0.35 },
        pressed && styles.pressedButton,
        inactive && styles.inactive,
      ]}
    >
      {/* Libellé long (« Aide et réclamations », anglais, tablette) : réduit sur une ligne,
          jamais coupé. Sans effet sur un libellé qui tient déjà. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={[
          styles.panelButtonText,
          selected && styles.panelButtonTextSelected,
          fontOf(fonts.button),
          { fontSize: Math.round(m.bodySize * (compact ? 1 : 1.1)) },
        ]}
      >
        {loading ? '…' : title}
      </Text>
    </Pressable>
  );
}

/** Groupe d'options (ON/OFF, Français/English) posé sur une plaque sombre. */
export function ChoiceGroup({
  children,
  style,
}: {
  children: ReactNode;
  /** Placement dans la ligne qui l'accueille (ex. aligné à droite, jamais rétréci). */
  style?: StyleProp<ViewStyle>;
}) {
  const { gap } = useLobbyMetrics();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.row, styles.choiceGroup, { gap, padding: gap * 0.5 }, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.75 },
  pressedButton: { opacity: 0.86, transform: [{ scale: 0.96 }] },
  inactive: { opacity: 0.5 },
  hudLeft: { position: 'absolute', alignItems: 'flex-start' },
  hudRight: { position: 'absolute' },
  nameBox: {
    justifyContent: 'center',
    borderRadius: salon.radius.control,
    borderWidth: 1,
    borderColor: salon.surface.border,
    backgroundColor: salon.surface.fill,
    experimental_backgroundImage: gameTheme.lacquer.surface,
    boxShadow: gameTheme.shadow.plate,
  },
  name: { color: salon.text, letterSpacing: 1 },
  counter: { color: salon.textSoft, ...titleShadow },
  coin: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: gameTheme.brass.deep,
    backgroundColor: gameTheme.brass.main,
    experimental_backgroundImage:
      'radial-gradient(circle at 35% 30%, #FBE7A6 0%, #E2C06F 38%, #B48D3E 78%, #8C6A2A 100%)',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 240, 200, 0.45)',
  },
  coinLetter: {
    color: salon.ink,
    fontWeight: '700',
    includeFontPadding: false,
  },
  plus: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: salon.emerald.fill,
    experimental_backgroundImage: salon.emerald.gradient,
    borderWidth: 1.5,
    borderColor: gameTheme.brass.bright,
  },
  plusText: { color: salon.text, fontWeight: '900', includeFontPadding: false },
  balance: { color: salon.brass.text, ...titleShadow },
  balanceColumn: { alignItems: 'flex-end' },
  reserved: { color: salon.textSoft, ...titleShadow },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: salon.surface.fill,
    experimental_backgroundImage: gameTheme.lacquer.surface,
    boxShadow: gameTheme.shadow.plate,
  },
  iconButtonDanger: {
    borderColor: salon.oxblood.border,
    backgroundColor: salon.oxblood.fill,
    experimental_backgroundImage: salon.oxblood.gradient,
  },
  backGlyph: { color: salon.text, fontWeight: '900', includeFontPadding: false },
  // Zone du panneau : tout l'écran utile, réduite par le clavier ouvert ; le panneau centré
  // s'y adapte (`flexShrink`), son contenu défile.
  keyboardArea: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    flexShrink: 1,
    borderRadius: salon.radius.panel,
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: salon.surface.fill,
    experimental_backgroundImage: salon.surface.gradient,
    boxShadow: `${salon.surface.shadow}, inset 0 1px 0 rgba(246, 239, 223, 0.06)`,
  },
  panelTitle: { color: salon.text, textAlign: 'center', letterSpacing: 1.2 },
  // Filet de laiton sous le titre, plus intense au centre.
  titleRule: {
    height: 1,
    alignSelf: 'stretch',
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(214, 178, 94, 0) 0%, rgba(214, 178, 94, 0.6) 50%, rgba(214, 178, 94, 0) 100%)',
  },
  close: {
    position: 'absolute',
    zIndex: 10,
    elevation: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: gameTheme.brass.hairline,
    backgroundColor: 'rgba(246, 239, 223, 0.06)',
  },
  closeText: { color: salon.textSoft, fontWeight: '700', includeFontPadding: false },
  // Zone d'actions : filet de laiton discret au-dessus, jamais dans le défilement.
  footer: { borderTopWidth: 1, borderTopColor: gameTheme.brass.hairline },
  inner: {
    borderRadius: salon.radius.card,
    borderWidth: 1,
    borderColor: salon.surface.wellBorder,
    backgroundColor: salon.surface.well,
  },
  panelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: salon.emerald.border,
    backgroundColor: salon.emerald.fill,
    experimental_backgroundImage: salon.emerald.gradient,
    boxShadow: '0 2px 5px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
  },
  panelButtonDanger: {
    borderColor: salon.oxblood.border,
    backgroundColor: salon.oxblood.fill,
    experimental_backgroundImage: salon.oxblood.gradient,
  },
  // Action principale : émeraude cerclée de laiton, légère lueur dorée.
  panelButtonPrimary: {
    borderWidth: 1.5,
    borderColor: gameTheme.brass.main,
    boxShadow: `0 2px 6px rgba(0, 0, 0, 0.45), 0 0 10px ${gameTheme.brass.faint}, inset 0 1px 0 rgba(255, 255, 255, 0.12)`,
  },
  // Action secondaire : creux sombre, filet émeraude ; ne concurrence pas l'action principale.
  panelButtonQuiet: {
    backgroundColor: salon.surface.well,
    experimental_backgroundImage: undefined,
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  },
  panelButtonSelected: {
    borderColor: salon.brass.border,
    backgroundColor: salon.brass.fill,
    experimental_backgroundImage: salon.brass.gradient,
  },
  panelButtonText: { color: salon.text, letterSpacing: 0.4 },
  panelButtonTextSelected: { color: salon.ink },
  choiceGroup: {
    borderRadius: salon.radius.control,
    borderWidth: 1,
    borderColor: salon.surface.wellBorder,
    backgroundColor: salon.surface.well,
  },
});
