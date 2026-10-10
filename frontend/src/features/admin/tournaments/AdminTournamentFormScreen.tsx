import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/ui/Button';
import { DatePickerField } from '../../../components/ui/DatePickerField';
import { TextField } from '../../../components/ui/TextField';
import { TimePickerField } from '../../../components/ui/TimePickerField';
import { colors, radius, spacing } from '../../../constants/theme';
import { ApiError } from '../../../lib/api-client';
import { todayOf } from '../../../lib/date-time';
import {
  defaultShares,
  defaultTournamentForm,
  fieldErrorsFromApi,
  MAX_RANKS,
  sharesTotal,
  toTournamentPayload,
  type TournamentFormErrors,
  type TournamentFormField,
  type TournamentFormValues,
} from '../../tournaments/tournament-form';
import { AdminGate } from './AdminGate';
import { AdminPage, adminStyles } from './AdminTournamentsScreen';
import { useCreateTournament } from './hooks';

/**
 * Création d'un tournoi par l'administration (route /admin/tournaments/new) : publié
 * directement par le serveur (commission copiée des paramètres, non-chevauchement vérifié en
 * base). Seul le format est contrôlé ici.
 */
export function AdminTournamentFormScreen() {
  return (
    <AdminGate>
      <AdminTournamentForm />
    </AdminGate>
  );
}

function AdminTournamentForm() {
  const [values, setValues] = useState<TournamentFormValues>(() => defaultTournamentForm());
  const [errors, setErrors] = useState<TournamentFormErrors>({});
  const create = useCreateTournament();
  const apiError = create.error instanceof ApiError ? create.error : undefined;

  const set = (field: Exclude<TournamentFormField, 'shares'>) => (text: string) => {
    setValues((v) => ({ ...v, [field]: text }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const submit = () => {
    const parsed = toTournamentPayload(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    create.mutate(parsed.payload, {
      onSuccess: (t) => router.replace(`/admin/tournaments/${t.tournamentId}`),
      onError: (err) => {
        if (err instanceof ApiError) setErrors(fieldErrorsFromApi(err.fields));
      },
    });
  };

  return (
    <AdminPage title="Créer un tournoi" backTo="/admin/tournaments">
      <View style={styles.field}>
        <Text style={styles.label}>Date</Text>
        <DatePickerField
          label="Date"
          value={values.date}
          onChange={set('date')}
          minDate={todayOf()}
          invalid={Boolean(errors.date)}
          style={[styles.picker, errors.date ? styles.pickerInvalid : null]}
          textStyle={styles.pickerText}
        />
        {errors.date ? <Text style={adminStyles.error}>{errors.date}</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Heure de début</Text>
        <TimePickerField
          label="Heure de début"
          value={values.startTime}
          onChange={set('startTime')}
          invalid={Boolean(errors.startTime)}
          style={[styles.picker, errors.startTime ? styles.pickerInvalid : null]}
          textStyle={styles.pickerText}
        />
        {errors.startTime ? <Text style={adminStyles.error}>{errors.startTime}</Text> : null}
      </View>
      <TextField
        label="Durée (minutes)"
        keyboardType="number-pad"
        value={values.durationMinutes}
        onChangeText={set('durationMinutes')}
        error={errors.durationMinutes}
      />
      <TextField
        label="Participation (FCFA)"
        keyboardType="number-pad"
        value={values.entryFee}
        onChangeText={set('entryFee')}
        error={errors.entryFee}
      />
      <TextField
        label="Joueurs minimum"
        keyboardType="number-pad"
        value={values.minimumPlayers}
        onChangeText={set('minimumPlayers')}
        error={errors.minimumPlayers}
      />
      <TextField
        label="Joueurs maximum (vide : sans limite)"
        keyboardType="number-pad"
        value={values.maximumPlayers}
        onChangeText={set('maximumPlayers')}
        error={errors.maximumPlayers}
      />

      <View style={adminStyles.section}>
        <Text style={adminStyles.sectionTitle}>
          {`Rangs récompensés : ${values.shares.length} · total ${sharesTotal(values.shares)} %`}
        </Text>
        <View style={styles.row}>
          <Button
            title="− Rang"
            variant="secondary"
            disabled={values.shares.length <= 1}
            onPress={() => setValues((v) => ({ ...v, shares: defaultShares(v.shares.length - 1) }))}
          />
          <Button
            title="+ Rang"
            variant="secondary"
            disabled={values.shares.length >= MAX_RANKS}
            onPress={() => setValues((v) => ({ ...v, shares: defaultShares(v.shares.length + 1) }))}
          />
        </View>
        {values.shares.map((share, index) => (
          <TextField
            key={index}
            label={`Part du rang ${index + 1} (%)`}
            keyboardType="decimal-pad"
            value={share}
            onChangeText={(text) =>
              setValues((v) => ({ ...v, shares: v.shares.map((s, i) => (i === index ? text : s)) }))
            }
          />
        ))}
        {errors.shares ? <Text style={adminStyles.error}>{errors.shares}</Text> : null}
      </View>

      <Text style={adminStyles.muted}>
        Le tournoi est publié dès sa création ; la commission appliquée est celle des paramètres
        actuels, figée pour ce tournoi.
      </Text>
      {apiError && !Object.keys(apiError.fields).length ? (
        <Text accessibilityRole="alert" style={adminStyles.error}>
          {apiError.message}
        </Text>
      ) : null}
      <Button title="Publier le tournoi" onPress={submit} loading={create.isPending} />
    </AdminPage>
  );
}

/** Sélecteurs Date et Heure : même apparence que `TextField`. */
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  field: { marginBottom: spacing.md, gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  picker: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  pickerInvalid: { borderColor: colors.danger },
  pickerText: { fontSize: 16, color: colors.text },
});
