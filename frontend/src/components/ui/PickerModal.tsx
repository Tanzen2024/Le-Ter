import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { tablePalette } from '../table/TableDecor';

/**
 * Fenêtre des sélecteurs de date et d'heure : fond assombri, carte sombre, titre et actions.
 * `supportedOrientations` : l'app est en paysage ; sans lui, iOS ouvrirait la fenêtre en
 * portrait.
 */
export function PickerModal({
  visible,
  title,
  onClose,
  children,
  actions,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={['landscape', 'portrait']}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={styles.card} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {children}
          <View style={styles.actions}>{actions}</View>
        </View>
      </View>
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
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={display ? { text: display } : undefined}
      aria-invalid={invalid}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, style, pressed && styles.pressed]}
    >
      <Text
        numberOfLines={1}
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
  muted: 'rgba(247, 241, 225, 0.45)',
  selected: tablePalette.gold,
  selectedText: '#2A1A05',
  today: tablePalette.gold,
  line: tablePalette.panelBorder,
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    padding: 12,
  },
  card: {
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tablePalette.panelBorder,
    backgroundColor: '#1B0D09',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  title: { color: tablePalette.gold, fontSize: 15, fontWeight: '700', textAlign: 'center' },
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
  actionPrimary: { backgroundColor: tablePalette.jade, borderColor: tablePalette.jade },
  actionText: { color: tablePalette.cream, fontWeight: '700' },
  actionTextPrimary: { color: tablePalette.gold },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  triggerText: { flex: 1 },
  triggerIcon: { opacity: 0.9 },
  placeholder: { opacity: 0.6 },
  pressed: { opacity: 0.75 },
});
