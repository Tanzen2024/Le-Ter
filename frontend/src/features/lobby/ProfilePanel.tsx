import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { useCurrentUser, useLogout } from '../auth/hooks';
import { useLobbyMetrics } from './lobby-metrics';
import { announceComingSoon, InnerFrame, LobbyPanel, PanelButton } from './LobbyUi';

/** Profil : données du compte renvoyées par /api/auth/me, et déconnexion. */
export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { data: user, isPending } = useCurrentUser();
  const logout = useLogout();

  const label = [styles.label, fontOf(fonts.button), { fontSize: Math.round(m.bodySize * 1.1) }];
  const value = [styles.value, { fontSize: m.smallSize }];
  const rows: [string, string | undefined][] = [
    ['ID', user?.id],
    ['Prénom', user?.firstName],
    ['Nom', user?.lastName],
    ['Téléphone', user?.phone],
    ['Email', user?.email],
  ];

  return (
    <LobbyPanel title="Profil" onClose={onClose} width={Math.max(340, m.width * 0.4)}>
      <InnerFrame style={{ gap: m.gap * 0.5 }}>
        {isPending ? <ActivityIndicator color={palette.gold} /> : null}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.username, fontOf(fonts.button), { fontSize: m.panelTitleSize * 0.72 }]}
        >
          {user?.username ?? ' '}
        </Text>
        {rows.map(([name, content]) => (
          <View key={name} style={styles.row}>
            <Text style={[label, styles.labelColumn]}>{name}</Text>
            <Text style={[value, styles.valueColumn]} numberOfLines={1} adjustsFontSizeToFit>
              {content ?? ''}
            </Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={[label, styles.labelColumn]}>Mot de passe</Text>
          <View style={styles.valueColumn}>
            {/* Aucun endpoint de changement de mot de passe n'existe encore. */}
            <View style={styles.start}>
              <PanelButton
                title="Modifier"
                accessibilityLabel="Modifier le mot de passe"
                onPress={() =>
                  announceComingSoon(
                    'Mot de passe',
                    'La modification du mot de passe sera bientôt disponible.',
                  )
                }
              />
            </View>
          </View>
        </View>
        <View style={[styles.row, styles.footer, { marginTop: m.gap }]}>
          <PanelButton
            title="Déconnexion"
            tone="danger"
            loading={logout.isPending}
            onPress={() => logout.mutate()}
          />
          {user ? (
            <Text style={[styles.certified, fontOf(fonts.button), { fontSize: m.bodySize }]}>
              {user.phoneVerified ? 'Certifié ' : 'Non certifié'}
              {user.phoneVerified ? <Text style={styles.check}>✓</Text> : null}
            </Text>
          ) : null}
        </View>
      </InnerFrame>
    </LobbyPanel>
  );
}

const styles = StyleSheet.create({
  username: { color: '#FFFFFF', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 24 },
  labelColumn: { width: '38%' },
  valueColumn: { flex: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
  label: { color: '#FFFFFF' },
  value: { color: '#FFFFFF', fontWeight: '600' },
  footer: { justifyContent: 'space-between' },
  certified: { color: '#FFFFFF' },
  check: { color: '#3FD06A' },
});
