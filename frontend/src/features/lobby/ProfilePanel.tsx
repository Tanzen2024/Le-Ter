import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { countryOfPhone, toNationalPhone } from '../../lib/country';
import { useCurrentUser, useLogout } from '../auth/hooks';
import { useLobbyMetrics } from './lobby-metrics';
import { InnerFrame, LobbyPanel, PanelButton } from './LobbyUi';
import { PasswordChangeForm } from './PasswordChangeForm';

/** Profil : données du compte renvoyées par /api/auth/me, et déconnexion. */
export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { data: user, isPending } = useCurrentUser();
  const logout = useLogout();
  // Formulaire du mot de passe ouvert ; confirmation affichée après un succès du serveur.
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const label = [styles.label, fontOf(fonts.button), { fontSize: Math.round(m.bodySize * 1.1) }];
  const value = [styles.value, { fontSize: m.smallSize }];
  // Lecture seule : seul le mot de passe se modifie ici. Le téléphone s'affiche sans
  // indicatif ; le pays se déduit de cet indicatif (inconnu → « — », jamais deviné).
  const country = user ? countryOfPhone(user.phone) : undefined;
  const rows: [string, string | undefined][] = [
    ['ID', user?.id],
    ['Prénom', user?.firstName],
    ['Nom', user?.lastName],
    ['Pays', user ? (country?.name.fr ?? '—') : undefined],
    ['Téléphone', user ? toNationalPhone(user.phone) : undefined],
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
            {editingPassword ? null : (
              <View style={styles.start}>
                <PanelButton
                  title="Modifier"
                  accessibilityLabel="Modifier le mot de passe"
                  onPress={() => {
                    setPasswordChanged(false);
                    setEditingPassword(true);
                  }}
                />
              </View>
            )}
          </View>
        </View>
        {editingPassword ? (
          <PasswordChangeForm
            onCancel={() => setEditingPassword(false)}
            onChanged={() => {
              setEditingPassword(false);
              setPasswordChanged(true);
            }}
          />
        ) : null}
        {passwordChanged ? (
          <Text
            style={[styles.success, { fontSize: m.smallSize }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            Mot de passe modifié.
          </Text>
        ) : null}
        <View style={[styles.row, styles.end, { marginTop: m.gap }]}>
          <PanelButton
            title="Déconnexion"
            tone="danger"
            loading={logout.isPending}
            onPress={() => logout.mutate()}
          />
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
  end: { justifyContent: 'flex-end' },
  label: { color: '#FFFFFF' },
  value: { color: '#FFFFFF', fontWeight: '600' },
  success: { color: '#3FD06A', fontWeight: '600' },
});
