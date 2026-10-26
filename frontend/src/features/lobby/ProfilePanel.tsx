import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { gameTheme, salon } from '../../constants/theme';
import { countryOfPhone, toNationalPhone } from '../../lib/country';
import { useCurrentUser, useLogout } from '../auth/hooks';
import { useComplaintMessages } from '../complaints/complaint-messages';
import { avatarToneOf, ChipArt } from '../games/table/TableParts';
import { useLobbyMetrics } from './lobby-metrics';
import { LobbyPanel, PanelButton } from './LobbyUi';
import { usePasswordChangeForm } from './PasswordChangeForm';
import { RecoveryCodeSection } from './RecoveryCodeSection';

/**
 * Profil : données du compte renvoyées par /api/auth/me, et déconnexion. Tenu sans défiler en
 * paysage, dans cet ordre :
 * 1. à gauche, la carte du joueur (jeton de la table, pseudo), étroite : l'identifiant
 *    technique n'est plus affiché, sa place revient aux informations et à la sécurité ;
 * 2. à droite, les informations en tuiles, puis la sécurité (mot de passe, code de
 *    récupération). « Modifier » ou un code en cours : le formulaire PREND LA PLACE des
 *    informations au lieu de s'ajouter dessous ; elles reviennent à l'annulation ;
 * 3. en bas, la zone d'actions du panneau, séparée et toujours visible : « Aide et
 *    réclamations » et « Déconnexion » ; pendant « Modifier », celles du formulaire
 *    (« Annuler », « Enregistrer »), qui restent ainsi visibles même clavier ouvert.
 * Le défilement du panneau ne sert plus qu'en dernier recours (clavier ouvert).
 */
export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { data: user, isPending } = useCurrentUser();
  const logout = useLogout();
  const complaintText = useComplaintMessages();
  // Formulaire du mot de passe ouvert ; confirmation affichée après un succès du serveur.
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  // Code de récupération en cours (saisie ou code affiché) : il prend la colonne de droite.
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const password = usePasswordChangeForm({
    onCancel: () => {
      password.reset();
      setEditingPassword(false);
    },
    onChanged: () => {
      setEditingPassword(false);
      setPasswordChanged(true);
    },
  });

  const chip = Math.round(m.panelTitleSize * 1.9);
  // Initiale du pseudo RÉEL (aucune image ni avatar inventé) ; rien tant qu'il n'est pas connu.
  const initial = user?.username ? [...user.username][0]!.toUpperCase() : '';
  const label = [styles.label, fontOf(fonts.button), { fontSize: m.smallSize }];
  const value = [styles.value, { fontSize: m.bodySize }];
  // Lecture seule : seul le mot de passe se modifie ici. Le téléphone s'affiche sans
  // indicatif ; le pays se déduit de cet indicatif (inconnu → « — », jamais deviné).
  const country = user ? countryOfPhone(user.phone) : undefined;
  const pairs: [string, string | undefined][][] = [
    [
      ['Prénom', user?.firstName],
      ['Nom', user?.lastName],
    ],
    [
      ['Pays', user ? (country?.name.fr ?? '—') : undefined],
      ['Téléphone', user ? toNationalPhone(user.phone) : undefined],
    ],
    // Email facultatif (D-135) : « — » si le joueur n'en a pas.
    [['Email', user ? (user.email ?? '—') : undefined]],
  ];
  const busy = editingPassword || recoveryOpen;
  // Carte du joueur : jeton et pseudo seulement, donc étroite ; le reste du panneau va aux
  // informations, au mot de passe et au code de récupération.
  const cardWidth = m.height >= 600 ? '30%' : '24%';
  const tile = [styles.tile, { paddingHorizontal: m.gap * 0.8, paddingVertical: m.gap * 0.45 }];

  return (
    <LobbyPanel
      title="Profil"
      onClose={onClose}
      width={Math.max(560, m.width * 0.78)}
      footer={
        editingPassword ? (
          password.actions
        ) : (
          <View style={[styles.actions, { gap: m.gap }]}>
            {/* Aide et réclamations (D-114) : assistant automatisé et suivi des dossiers. */}
            <View style={styles.action}>
              <PanelButton title={complaintText.title} onPress={() => router.push('/support')} />
            </View>
            <View style={styles.action}>
              <PanelButton
                title="Déconnexion"
                tone="danger"
                loading={logout.isPending}
                onPress={() => logout.mutate()}
              />
            </View>
          </View>
        )
      }
    >
      <View style={[styles.columns, { gap: m.gap * 1.2 }]}>
        {/* Carte du joueur : un seul fond, aucun second cadre autour des colonnes. */}
        <View style={[styles.card, { width: cardWidth, gap: m.gap * 0.5, padding: m.gap * 0.8 }]}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.chip, { width: chip, height: chip, borderRadius: chip / 2 }]}
          >
            <ChipArt tone={avatarToneOf(user?.username ?? '')} />
            <Text
              allowFontScaling={false}
              style={[styles.initial, fontOf(fonts.title), { fontSize: Math.round(chip * 0.42) }]}
            >
              {initial}
            </Text>
          </View>
          {isPending ? <ActivityIndicator color={palette.gold} /> : null}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.username, fontOf(fonts.button), { fontSize: m.panelTitleSize * 0.66 }]}
          >
            {user?.username ?? ' '}
          </Text>
          {passwordChanged ? (
            <Text
              style={[styles.success, { fontSize: m.smallSize }]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              Mot de passe modifié.
            </Text>
          ) : null}
        </View>

        <View style={[styles.details, { gap: m.gap * 0.6 }]}>
          {/* Informations : masquées (jamais perdues) pendant une modification. */}
          {busy ? null : (
            <View style={{ gap: m.gap * 0.5 }}>
              {pairs.map((pair) => (
                <View key={pair[0]![0]} style={[styles.pair, { gap: m.gap * 0.5 }]}>
                  {pair.map(([name, content]) => (
                    <View key={name} style={tile}>
                      <Text style={label} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text
                        style={value}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                      >
                        {content ?? ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}

          {/* Sécurité : deux tuiles côte à côte ; une modification en cours prend la largeur.
              Positions fixes dans l'arbre : la saisie en cours n'est jamais perdue. */}
          <View style={[styles.pair, { gap: m.gap * 0.5 }]}>
            {recoveryOpen ? null : (
              <View style={[tile, styles.security, { gap: m.gap * 0.4 }]}>
                <Text style={label}>Mot de passe</Text>
                {editingPassword ? (
                  password.fields
                ) : (
                  <View style={styles.start}>
                    <PanelButton
                      compact
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
            )}
            {user && !editingPassword ? (
              <View style={[tile, styles.security, { gap: m.gap * 0.4 }]}>
                <Text style={label}>Code de récupération</Text>
                <RecoveryCodeSection
                  hasCode={user.hasRecoveryCode ?? false}
                  onExpandedChange={setRecoveryOpen}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </LobbyPanel>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'stretch' },
  // Carte du joueur : creux du panneau, filet de laiton fin.
  // Jeton et pseudo centrés dans la carte, horizontalement ET verticalement.
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: salon.radius.card,
    borderWidth: 1,
    borderColor: salon.surface.border,
    backgroundColor: salon.surface.well,
  },
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: gameTheme.brass.main,
    boxShadow: `${gameTheme.shadow.plate}, 0 0 12px ${gameTheme.brass.faint}`,
  },
  initial: {
    color: gameTheme.ivory,
    includeFontPadding: false,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  username: { alignSelf: 'stretch', textAlign: 'center', color: salon.text, letterSpacing: 0.6 },
  // Zone d'actions : deux boutons de même largeur qui se partagent toute la largeur du panneau.
  actions: { flexDirection: 'row' },
  action: { flexBasis: 0, flexGrow: 1 },
  details: { flex: 1, minWidth: 0 },
  pair: { flexDirection: 'row', alignItems: 'stretch' },
  // Tuile d'information : creux discret, libellé au-dessus de la valeur.
  tile: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    borderRadius: salon.radius.control,
    borderWidth: 1,
    borderColor: salon.surface.wellBorder,
    backgroundColor: salon.surface.well,
  },
  security: { borderColor: salon.surface.border },
  start: { alignSelf: 'flex-start' },
  label: { color: salon.textSoft, letterSpacing: 0.4 },
  value: { color: salon.text, fontWeight: '600' },
  success: { color: salon.status.positive.text, fontWeight: '600', textAlign: 'center' },
});
