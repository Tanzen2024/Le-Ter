import { useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';

import { Button } from '../../../components/ui/Button';
import { TextField } from '../../../components/ui/TextField';
import { colors } from '../../../constants/theme';
import { ApiError } from '../../../lib/api-client';
import type { TournamentSettings } from '../../../types/tournament';
import { AdminGate } from './AdminGate';
import { AdminPage, adminStyles } from './AdminTournamentsScreen';
import { useTournamentSettings, useUpdateTournamentSettings } from './hooks';

/** Paramètres exposés par l'API (D-054) : aucun autre n'est inventé ici. */
export const SETTING_FIELDS: { key: keyof TournamentSettings; label: string; decimal?: boolean }[] =
  [
    { key: 'platformFeePercent', label: 'Commission plateforme (%)', decimal: true },
    { key: 'initialTournamentTokens', label: 'Jetons de tournoi initiaux' },
    { key: 'defaultTournamentStake', label: 'Mise par partie par défaut (jetons)' },
    {
      key: 'maximumPendingTournamentsPerPlayer',
      label: 'Propositions en attente par joueur (max.)',
    },
    { key: 'tournamentTransitionMinutes', label: 'Transition entre tournois (minutes)' },
    { key: 'rankingTokensWeightPercent', label: 'Classement : poids des jetons restants (%)' },
    { key: 'rankingGamesWeightPercent', label: 'Classement : poids des parties jouées (%)' },
  ];

/** Paramètres des tournois (route /admin/tournaments/settings). */
export function AdminTournamentSettingsScreen() {
  return (
    <AdminGate>
      <Settings />
    </AdminGate>
  );
}

function Settings() {
  const { data, isPending, error } = useTournamentSettings();
  if (isPending) {
    return (
      <AdminPage title="Paramètres des tournois" backTo="/admin/tournaments">
        <ActivityIndicator color={colors.feltLight} />
      </AdminPage>
    );
  }
  if (error || !data) {
    return (
      <AdminPage title="Paramètres des tournois" backTo="/admin/tournaments">
        <Text style={adminStyles.error}>{error?.message ?? 'Paramètres indisponibles.'}</Text>
      </AdminPage>
    );
  }
  return <SettingsForm initial={data} />;
}

function SettingsForm({ initial }: { initial: TournamentSettings }) {
  const update = useUpdateTournamentSettings();
  const [values, setValues] = useState<Record<keyof TournamentSettings, string>>(
    () =>
      Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, String(initial[f.key])])) as Record<
        keyof TournamentSettings,
        string
      >,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof TournamentSettings, string>>>({});
  const [saved, setSaved] = useState(false);

  const save = () => {
    const patch: Partial<TournamentSettings> = {};
    const formatErrors: typeof errors = {};
    for (const f of SETTING_FIELDS) {
      const raw = values[f.key].trim().replace(',', '.');
      const pattern = f.decimal ? /^\d+(\.\d{1,2})?$/ : /^\d+$/;
      if (!pattern.test(raw)) formatErrors[f.key] = 'Nombre attendu.';
      else if (Number(raw) !== initial[f.key]) patch[f.key] = Number(raw);
    }
    setErrors(formatErrors);
    setSaved(false);
    if (Object.keys(formatErrors).length > 0 || Object.keys(patch).length === 0) return;
    update.mutate(patch, {
      onSuccess: () => setSaved(true),
      onError: (err) => {
        if (err instanceof ApiError) setErrors(err.fields as typeof errors);
      },
    });
  };

  return (
    <AdminPage title="Paramètres des tournois" backTo="/admin/tournaments">
      {SETTING_FIELDS.map((f) => (
        <TextField
          key={f.key}
          label={f.label}
          keyboardType={f.decimal ? 'decimal-pad' : 'number-pad'}
          value={values[f.key]}
          onChangeText={(text) => {
            setValues((v) => ({ ...v, [f.key]: text }));
            setErrors((e) => ({ ...e, [f.key]: undefined }));
          }}
          error={errors[f.key]}
        />
      ))}
      <Text style={adminStyles.muted}>
        Les deux poids du classement totalisent 100 %. Les tournois déjà publiés conservent la
        commission et les poids copiés à leur publication.
      </Text>
      {saved ? <Text style={adminStyles.success}>Paramètres enregistrés.</Text> : null}
      {update.error &&
      !(update.error instanceof ApiError && Object.keys(update.error.fields).length) ? (
        <Text accessibilityRole="alert" style={adminStyles.error}>
          {update.error.message}
        </Text>
      ) : null}
      <Button title="Enregistrer" onPress={save} loading={update.isPending} />
    </AdminPage>
  );
}
