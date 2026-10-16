import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { tablePalette } from '../../components/table/TableDecor';
import type { ComplaintCategory } from '../../types/complaint';
import { useComplaintMessages } from './complaint-messages';

/**
 * Raccourci « Signaler un problème » depuis une partie ou un tournoi (D-114). Il ne transmet que
 * le contexte déjà affiché (identifiant de partie ou de tournoi, catégorie suggérée) : le
 * serveur vérifie toujours que le joueur y a réellement accès avant de lier l'élément.
 */
export function ReportProblemLink({
  gameId,
  tournamentId,
  category,
}: {
  gameId?: string;
  tournamentId?: string;
  category?: ComplaintCategory;
}) {
  const t = useComplaintMessages();
  return (
    <Pressable
      testID="report-problem-link"
      accessibilityRole="link"
      accessibilityLabel={t.shortcut.a11y}
      hitSlop={6}
      onPress={() =>
        router.push({
          pathname: '/support',
          params: {
            ...(gameId && { gameId }),
            ...(tournamentId && { tournamentId }),
            ...(category && { category }),
          },
        })
      }
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={styles.text}>⚑ {t.shortcut.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  pressed: { opacity: 0.7 },
  text: { color: tablePalette.gold, textDecorationLine: 'underline', fontSize: 13 },
});
