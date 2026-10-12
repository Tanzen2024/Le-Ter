import { Pressable, StyleSheet, Text, View } from 'react-native';

import { tablePalette } from '../../components/table/TableDecor';
import { useLanguage } from '../../lib/i18n';
import { useMarkNotificationRead, useNotifications } from '../tournaments/hooks';

const MESSAGES = {
  fr: { title: 'Avertissement de l’administration', ok: 'J’ai compris' },
  en: { title: 'Warning from the administration', ok: 'I understand' },
} as const;

/**
 * Avertissement envoyé par l'administration (D-079), reçu par les notifications dans
 * l'application (pas de push). Le plus ancien avertissement non lu est affiché par-dessus
 * l'accueil ; « J'ai compris » le marque comme lu côté serveur. Le texte est affiché tel
 * quel (texte brut, jamais interprété).
 */
export function ModerationNotice() {
  const language = useLanguage();
  const t = MESSAGES[language as keyof typeof MESSAGES] ?? MESSAGES.fr;
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const warning = (data?.notifications ?? [])
    .filter((n) => n.type === 'MODERATION_WARNING' && !n.readAt)
    .at(-1);
  if (!warning) return null;

  return (
    <View style={styles.backdrop} accessibilityViewIsModal>
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.title}>⚠️ {t.title}</Text>
        <Text style={styles.message}>{warning.payload.message ?? ''}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={markRead.isPending}
          onPress={() => markRead.mutate(warning.id)}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{t.ok}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 16,
    zIndex: 50,
  },
  card: {
    maxWidth: 480,
    width: '100%',
    borderRadius: 16,
    padding: 20,
    gap: 12,
    backgroundColor: tablePalette.backdrop,
    borderWidth: 1,
    borderColor: tablePalette.gold,
  },
  title: { color: tablePalette.gold, fontSize: 18, fontWeight: '700' },
  message: { color: '#fff', fontSize: 15, lineHeight: 21 },
  button: {
    alignSelf: 'flex-end',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: tablePalette.gold,
  },
  pressed: { opacity: 0.8 },
  buttonText: { color: tablePalette.backdrop, fontWeight: '700' },
});
