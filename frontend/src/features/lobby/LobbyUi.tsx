import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
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
  tablePalette as palette,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { useMessages } from '../../lib/i18n';
import { playSound, type SoundName } from '../../services/audio-service';
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
 * Solde affiché : le DISPONIBLE (solde − réservé, D-054) ; les fonds bloqués par des
 * inscriptions à des tournois sont indiqués à part (`reserved`), jamais additionnés.
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

export function LobbyHud({ username, onAddCoins }: { username?: string; onAddCoins: () => void }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const balance = useBalanceLabel();
  const t = useMessages();
  return (
    <>
      <View style={[styles.hudLeft, { top: m.safe.top, left: m.safe.left, gap: m.gap * 0.6 }]}>
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
        {/* Compteur de la maquette : aucune donnée serveur ne l'alimente encore. */}
        <View
          style={[styles.row, { gap: m.gap * 0.8, paddingLeft: m.hudBoxHeight * 0.1 }]}
          accessible
          accessibilityLabel={t.lobby.counterUnavailable}
        >
          <Text allowFontScaling={false} style={{ fontSize: m.hudCounterIcon }}>
            🧑
          </Text>
          <Text style={[styles.counter, fontOf(fonts.button), { fontSize: m.hudCounterSize }]}>
            {UNAVAILABLE}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.row,
          styles.hudRight,
          { top: m.safe.top, right: m.safe.right + m.gap, gap: m.gap * 1.4 },
        ]}
      >
        <Pressable
          onPress={onAddCoins}
          accessibilityRole="button"
          accessibilityLabel={t.lobby.addCoins}
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
        <View accessible accessibilityLabel={balance.label} style={styles.balanceColumn}>
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

/** Jeton « L » turquoise cerclé d'or (monnaie de la maquette). */
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

/** Bouton carré arrondi du bas d'écran : turquoise (profil, réglages) ou rouge (retour). */
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

/** Flèche circulaire blanche du bouton retour. */
export function BackGlyph() {
  const { iconButton } = useLobbyMetrics();
  return (
    <Text allowFontScaling={false} style={[styles.backGlyph, { fontSize: iconButton * 0.62 }]}>
      ↺
    </Text>
  );
}

/**
 * Panneau superposé (Profil, Réglages, Partie privée) : fond assombri, plaque sombre bordée,
 * titre blanc centré, bouton de fermeture rouge. Le bouton retour Android et un appui hors du
 * panneau le ferment. Le contenu défile si la hauteur manque (petits smartphones).
 */
export function LobbyPanel({
  title,
  onClose,
  width,
  below,
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
  children: ReactNode;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const t = useMessages();
  const closeName = closeLabel ?? t.common.close;
  const [appear] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [appear]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const close = Math.max(40, Math.round(m.panelTitleSize * 1.15));
  const padding = Math.round(m.gap * 1.2);
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        {
          paddingTop: m.safe.top,
          paddingBottom: m.safe.bottom,
          paddingLeft: m.safe.left,
          paddingRight: m.safe.right,
        },
      ]}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel={closeName}
        importantForAccessibility="no"
      />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.panel,
          {
            width: Math.min(width, m.availableWidth),
            maxHeight: m.availableHeight - (below ? m.controlHeight + m.gap : 0),
            padding,
            opacity: appear,
            transform: [
              { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
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
            { fontSize: m.panelTitleSize, marginHorizontal: close + 4, marginBottom: m.gap * 0.6 },
          ]}
        >
          {title}
        </Text>
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
          <Text style={[styles.closeText, fontOf(fonts.button), { fontSize: close * 0.62 }]}>
            X
          </Text>
        </Pressable>
        <ScrollView
          style={styles.shrink}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {children}
        </ScrollView>
      </Animated.View>
      {below ? (
        <Animated.View style={{ opacity: appear, marginTop: m.gap * 0.6 }}>{below}</Animated.View>
      ) : null}
    </View>
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

/** Petit bouton rectangulaire des panneaux : texte doré sur jade, rouge, ou doré (sélection). */
export function PanelButton({
  title,
  onPress,
  tone = 'jade',
  selected,
  disabled = false,
  loading = false,
  accessibilityLabel,
  sound = 'uiClick',
}: {
  title: string;
  onPress: () => void;
  tone?: 'jade' | 'danger';
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
  const height = Math.max(36, Math.round(m.controlHeight * 0.9));
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
        selected && styles.panelButtonSelected,
        { height, paddingHorizontal: height * 0.35 },
        pressed && styles.pressedButton,
        inactive && styles.inactive,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.panelButtonText,
          selected && styles.panelButtonTextSelected,
          fontOf(fonts.button),
          { fontSize: Math.round(m.bodySize * 1.1) },
        ]}
      >
        {loading ? '…' : title}
      </Text>
    </Pressable>
  );
}

/** Groupe d'options (ON/OFF, Français/English) posé sur une plaque sombre. */
export function ChoiceGroup({ children }: { children: ReactNode }) {
  const { gap } = useLobbyMetrics();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.row, styles.choiceGroup, { gap, padding: gap * 0.5 }]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.75 },
  pressedButton: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  inactive: { opacity: 0.55 },
  hudLeft: { position: 'absolute', alignItems: 'flex-start' },
  hudRight: { position: 'absolute' },
  nameBox: {
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    backgroundColor: palette.panel,
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.45)',
  },
  name: { color: palette.cream, letterSpacing: 1 },
  counter: { color: palette.gold, ...titleShadow },
  coin: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: palette.goldDeep,
    backgroundColor: palette.teal,
    experimental_backgroundImage: 'linear-gradient(180deg, #2DB3B1 0%, #1C9396 55%, #17797F 100%)',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.5)',
  },
  coinLetter: { color: palette.gold, fontWeight: '700', includeFontPadding: false },
  plus: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2FA43A',
    borderWidth: 1.5,
    borderColor: '#BDF5B0',
  },
  plusText: { color: '#FFFFFF', fontWeight: '900', includeFontPadding: false },
  balance: { color: palette.gold, ...titleShadow },
  balanceColumn: { alignItems: 'flex-end' },
  reserved: { color: palette.cream, opacity: 0.85, ...titleShadow },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backgroundColor: palette.teal,
    experimental_backgroundImage: 'linear-gradient(180deg, #2DB3B1 0%, #1C9396 55%, #17797F 100%)',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.45)',
  },
  iconButtonDanger: {
    backgroundColor: palette.danger,
    experimental_backgroundImage: 'linear-gradient(180deg, #EE4B4B 0%, #D42A33 55%, #A81C24 100%)',
  },
  backGlyph: { color: '#FFFFFF', fontWeight: '900', includeFontPadding: false },
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  panel: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    backgroundColor: palette.panel,
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)',
  },
  panelTitle: { color: '#FFFFFF', textAlign: 'center', ...titleShadow },
  close: {
    position: 'absolute',
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#8E1A1F',
    backgroundColor: palette.danger,
    experimental_backgroundImage: 'linear-gradient(180deg, #F0484C 0%, #D42A33 60%, #B21F27 100%)',
  },
  closeText: { color: '#FFD84A', includeFontPadding: false },
  inner: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  panelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.4)',
    backgroundColor: palette.jade,
    experimental_backgroundImage: 'linear-gradient(180deg, #23A088 0%, #17806E 60%, #106456 100%)',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.4)',
  },
  panelButtonDanger: {
    backgroundColor: palette.danger,
    experimental_backgroundImage: 'linear-gradient(180deg, #EE4B4B 0%, #D42A33 60%, #A81C24 100%)',
  },
  panelButtonSelected: {
    backgroundColor: palette.gold,
    experimental_backgroundImage: 'linear-gradient(180deg, #FFE27A 0%, #F2C451 60%, #D9A52E 100%)',
  },
  panelButtonText: { color: '#FFD84A' },
  panelButtonTextSelected: { color: '#0F3D2E' },
  choiceGroup: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
});
