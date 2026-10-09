import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  fontOf,
  tablePalette as palette,
  useTableFonts,
} from '../../../components/table/TableDecor';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';

/** Fermeture par le bouton retour Android tant que le composant est affiché. */
export function useBackToClose(onClose: () => void) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
}

export function useAppear() {
  const [appear] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [appear]);
  return appear;
}

/**
 * « Voulez-vous vraiment quitter la partie ? » : voile léger, plaque sombre translucide à
 * liseré doré, NON neutre, OUI rouge. Le serveur décide si le départ est possible (D-037) :
 * son refus s'affiche ici.
 */
export function QuitDialog({
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  error?: string;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const appear = useAppear();
  useBackToClose(onCancel);
  const buttonHeight = Math.max(40, Math.round(m.controlHeight * 0.85));
  const button = [styles.dialogButton, { height: buttonHeight, borderRadius: buttonHeight / 2 }];
  const label = [styles.dialogButtonText, fontOf(fonts.button), { fontSize: m.bodySize * 1.1 }];
  return (
    <View style={[StyleSheet.absoluteFill, styles.veil]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onCancel}
        importantForAccessibility="no"
      />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.dialog,
          {
            width: Math.min(Math.max(m.width * 0.36, 280), 420),
            padding: m.gap * 1.6,
            gap: m.gap * 1.2,
            opacity: appear,
            transform: [
              {
                scale: appear.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
              },
            ],
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.dialogText, fontOf(fonts.button), { fontSize: m.bodySize * 1.25 }]}
        >
          Voulez-vous vraiment quitter la partie ?
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={[styles.dialogError, { fontSize: m.smallSize }]}>
            {error}
          </Text>
        ) : null}
        <View style={[styles.dialogRow, { gap: m.gap * 1.5 }]}>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            style={({ pressed }) => [...button, styles.dialogNo, pressed && styles.pressed]}
          >
            <Text style={label}>NON</Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            disabled={pending}
            accessibilityRole="button"
            accessibilityState={{ busy: pending }}
            style={({ pressed }) => [...button, styles.dialogYes, pressed && styles.pressed]}
          >
            {pending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={label}>OUI</Text>}
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  veil: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  dialog: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.4)',
    backgroundColor: 'rgba(18, 10, 6, 0.86)',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.4)',
  },
  dialogText: { color: '#FFFFFF', textAlign: 'center' },
  dialogError: { color: palette.error, textAlign: 'center', fontWeight: '600' },
  dialogRow: { flexDirection: 'row', alignSelf: 'stretch' },
  dialogButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  dialogNo: {
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  dialogYes: {
    borderColor: 'rgba(255, 255, 255, 0.18)',
    backgroundColor: '#A3252C',
    experimental_backgroundImage: 'linear-gradient(180deg, #BC343C 0%, #8E1E24 100%)',
  },
  dialogButtonText: { color: '#FFFFFF', letterSpacing: 1 },
});
