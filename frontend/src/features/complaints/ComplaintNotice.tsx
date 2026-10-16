import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { tablePalette } from '../../components/table/TableDecor';
import { useMarkNotificationRead, useNotifications } from '../tournaments/hooks';
import { useComplaintMessages } from './complaint-messages';

/** Notification « réclamation mise à jour » (D-114) : référence et nature, jamais de montant. */
interface ComplaintUpdate {
  id: string;
  readAt?: string;
  payload: { complaintId?: string; reference?: string; event?: string };
}

export const COMPLAINT_NOTIFICATION = 'COMPLAINT_UPDATE';

/**
 * Bandeau discret à l'accueil : la plus récente mise à jour non lue d'une réclamation. Un appui
 * ouvre le dossier et marque la notification comme lue. Lue dans PostgreSQL : un joueur
 * déconnecté la retrouve à sa prochaine connexion.
 */
export function ComplaintNotice() {
  const t = useComplaintMessages();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const update = (data?.notifications ?? [])
    .filter((n) => (n.type as string) === COMPLAINT_NOTIFICATION && !n.readAt)
    .map((n) => n as unknown as ComplaintUpdate)
    .at(0);
  if (!update?.payload.complaintId) return null;
  const { complaintId, reference = '', event = '' } = update.payload;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        markRead.mutate(update.id);
        router.push(`/support/${complaintId}`);
      }}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
    >
      <Text style={styles.text}>📨 {t.notification(reference, event)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 8,
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
