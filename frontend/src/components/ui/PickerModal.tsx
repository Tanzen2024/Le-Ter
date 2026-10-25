import type { ReactNode, Ref } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { gameTheme, salon } from '../../constants/theme';

import { tablePalette } from '../table/TableDecor';
import { ExclusiveOverlay } from './ExclusiveOverlay';

/**
 * Fenêtre des sélecteurs de date et d'heure : seule visible (D-126), carte sombre, titre et
 * actions.
 * `supportedOrientations` : l'app est en paysage ; sans lui, iOS ouvrirait la fenêtre en
 * portrait.
 */
export function PickerModal({
  visible,
  title,
  onClose,
  children,
  actions,
  scroll = false,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
  /** Contenu défilant si la hauteur manque (calendrier) ; jamais autour d'une liste. */
  scroll?: boolean;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={['landscape', 'portrait']}
      onRequestClose={onClose}
    >
      <ExclusiveOverlay style={styles.backdrop}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {/* `scroll` : écran trop bas (petit téléphone en paysage), le contenu défile, titre et
              actions restent visibles ; jamais une rangée coupée par le bord de la fenêtre.
              Pas pour un contenu qui défile déjà lui-même (liste des pays). */}
          {scroll ? (
            <ScrollView
              testID="picker-scroll"
              style={styles.content}
              contentContainerStyle={styles.contentInner}
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
          <View style={styles.actions}>{actions}</View>
        </View>
      </ExclusiveOverlay>
    </Modal>
  );
}

export function PickerAction({
  title,
  onPress,
  primary = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{title}</Text>
    </Pressable>
  );
}

/** Champ déclencheur (date ou heure) : valeur affichée et icône, ouvre le sélecteur. */
export function PickerTrigger({
  label,
  hint,
  display,
  placeholder,
  icon,
  onPress,
  invalid,
  style,
  textStyle,
  testID,
  lines = 1,
  shrinkToFit = false,
  active = false,
  ref,
}: {
  label: string;
  hint: string;
  display: string | undefined;
  placeholder?: string;
  icon: string;
  onPress: () => void;
  invalid?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  /** Lignes du texte affiché avant « … » (un long nom de pays peut en demander 2). */
  lines?: number;
  /** Réduit la police (jusqu'à 65 %) pour que le texte tienne sans être tronqué. */
  shrinkToFit?: boolean;
  /** Sélecteur ouvert et accroché à ce champ : filet doré. */
  active?: boolean;
  /** Champ mesuré pour y accrocher la fenêtre (`AnchoredPopover`). */
  ref?: Ref<View>;
}) {
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={display ? { text: display } : undefined}
      accessibilityState={{ expanded: active }}
      aria-invalid={invalid}
      onPress={onPress}
      style={({ pressed }) => [
        styles.trigger,
        style,
        active && styles.triggerActive,
        pressed && styles.pressed,
      ]}
    >
      <Text
        numberOfLines={lines}
        adjustsFontSizeToFit={shrinkToFit}
        minimumFontScale={shrinkToFit ? 0.65 : undefined}
        style={[styles.triggerText, textStyle, !display && styles.placeholder]}
      >
        {display ?? placeholder ?? ''}
      </Text>
      <Text
        style={[styles.triggerIcon, textStyle]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {icon}
      </Text>
    </Pressable>
  );
}

export const pickerColors = {
  text: tablePalette.cream,
  muted: salon.textFaint,
  selected: tablePalette.gold,
  selectedText: salon.ink,
  today: tablePalette.gold,
  line: tablePalette.panelBorder,
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  card: {
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: salon.radius.card,
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: salon.surface.fill,
    experimental_backgroundImage: salon.surface.gradient,
    boxShadow: salon.surface.shadow,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  title: {
    color: tablePalette.gold,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: { flexGrow: 0, flexShrink: 1 },
  contentInner: { gap: 8, alignItems: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  action: {
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tablePalette.panelBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: {
    backgroundColor: salon.brass.fill,
    experimental_backgroundImage: salon.brass.gradient,
    borderColor: salon.brass.border,
  },
  actionText: { color: tablePalette.cream, fontWeight: '700' },
  actionTextPrimary: { color: salon.ink },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  triggerActive: {
    borderColor: pickerColors.selected,
    boxShadow: '0 0 0 3px rgba(245, 200, 66, 0.16)',
  },
  triggerText: { flex: 1 },
  triggerIcon: { opacity: 0.9 },
  placeholder: { opacity: 0.6 },
  pressed: { opacity: 0.75 },
});
