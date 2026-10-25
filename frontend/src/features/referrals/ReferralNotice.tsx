import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { tablePalette } from '../../components/table/TableDecor';
import { useMarkNotificationRead, useNotifications } from '../tournaments/hooks';
import { useReferralMessages } from './referral-messages';

export const REFERRAL_NOTIFICATION = 'REFERRAL_REWARD_CREDITED';

interface RewardCredited {
  id: string;
  readAt?: string;
  payload: { amount?: number; tier?: number };
}

/**
 * Bandeau discret à l'accueil (D-161) : récompense de parrainage CRÉDITÉE, telle qu'écrite par
 * le serveur dans la transaction du crédit. Lue une seule fois : un appui ouvre la section
 * Parrainage et la marque comme lue (elle ne revient pas à chaque rafraîchissement).
 */
export function ReferralNotice() {
  const t = useReferralMessages();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const reward = (data?.notifications ?? [])
    .filter((n) => (n.type as string) === REFERRAL_NOTIFICATION && !n.readAt)
    .map((n) => n as unknown as RewardCredited)
    .at(0);
  if (!reward || typeof reward.payload.amount !== 'number') return null;

  return (
    <Pressable
      testID="referral-notice"
      accessibilityRole="button"
      onPress={() => {
        markRead.mutate(reward.id);
        router.push('/support?tab=referral');
      }}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
    >
      <Text style={styles.text}>{t.notice(t.tokens(reward.payload.amount))}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 52,
    alignSelf: 'center',
    maxWidth: 520,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: tablePalette.panel,
    borderWidth: 1,
    borderColor: tablePalette.gold,
    zIndex: 40,
  },
  pressed: { opacity: 0.8 },
  text: { color: tablePalette.cream, fontWeight: '600' },
});
