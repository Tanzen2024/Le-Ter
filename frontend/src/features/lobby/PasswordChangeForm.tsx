import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { salon } from '../../constants/theme';
import { fontOf, useTableFonts } from '../../components/table/TableDecor';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api-client';
import type { ChangePasswordPayload } from '../../types/auth';
import { useChangePassword } from '../auth/hooks';
import { validatePasswordChange, type FieldErrors } from '../auth/validation';
import { useLobbyMetrics } from './lobby-metrics';
import { PanelButton } from './LobbyUi';

type Field = keyof ChangePasswordPayload;

const FIELDS: { key: Field; label: string }[] = [
  { key: 'currentPassword', label: 'Mot de passe actuel' },
  { key: 'newPassword', label: 'Nouveau mot de passe' },
  { key: 'confirmPassword', label: 'Confirmer le nouveau mot de passe' },
];

const EMPTY: ChangePasswordPayload = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

/**
 * Changement du mot de passe, autonome : les champs puis leurs actions. Dans le Profil, les
 * actions vont dans la zone d'actions du panneau (`usePasswordChangeForm`).
 */
export function PasswordChangeForm(props: { onCancel: () => void; onChanged: () => void }) {
  const m = useLobbyMetrics();
  const form = usePasswordChangeForm(props);
  return (
    <View style={{ gap: m.gap * 0.5 }}>
      {form.fields}
      {form.actions}
    </View>
  );
}

/**
 * Changement du mot de passe, dans le panneau Profil (POST /api/auth/password). Le serveur
 * reste juge : la validation locale n'évite qu'un aller-retour. Le succès n'est annoncé
 * qu'après la réponse du serveur ; en cas d'erreur, la saisie est conservée. Renvoie les
 * champs et, séparément, les actions (Annuler, Enregistrer) pour qu'elles restent visibles
 * dans la zone d'actions du panneau, même clavier ouvert. `reset` vide la saisie.
 */
export function usePasswordChangeForm({
  onCancel,
  onChanged,
}: {
  onCancel: () => void;
  onChanged: () => void;
}): { fields: ReactNode; actions: ReactNode; reset: () => void } {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const change = useChangePassword();
  const [values, setValues] = useState<ChangePasswordPayload>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const edit = (key: Field) => (text: string) => {
    setValues((v) => ({ ...v, [key]: text }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setFormError(null);
  };

  const submit = () => {
    if (change.isPending) return;
    const local = validatePasswordChange(values);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;
    change.mutate(values, {
      onSuccess: () => {
        setValues(EMPTY);
        onChanged();
      },
      onError: (err) => {
        const fields = err instanceof ApiError ? err.fields : {};
        const known = FIELDS.filter(({ key }) => fields[key]);
        setErrors(Object.fromEntries(known.map(({ key }) => [key, fields[key]])));
        // Un message par champ suffit ; sinon, message général (réseau, limite, serveur).
        if (known.length === 0) {
          setFormError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
        }
      },
    });
  };

  const label = [styles.label, fontOf(fonts.button), { fontSize: m.smallSize }];
  const message = { fontSize: m.smallSize };
  const field = ({ key, label: name }: (typeof FIELDS)[number], i: number) => (
    <View key={key} style={[styles.field, { gap: 3 }]}>
      <Text style={label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {name}
      </Text>
      <TextField
        appearance="table"
        label={name}
        secret
        controlHeight={m.controlHeight * 0.85}
        value={values[key]}
        onChangeText={edit(key)}
        error={errors[key]}
        editable={!change.isPending}
        autoCapitalize="none"
        autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'}
        textContentType={key === 'currentPassword' ? 'password' : 'newPassword'}
        returnKeyType={i === FIELDS.length - 1 ? 'done' : 'next'}
        onSubmitEditing={i === FIELDS.length - 1 ? submit : undefined}
      />
      {errors[key] ? (
        <Text style={[styles.error, message]} accessibilityLiveRegion="polite">
          {errors[key]}
        </Text>
      ) : null}
    </View>
  );
  // Compact pour tenir dans le profil sans défiler : mot de passe actuel sur une ligne, nouveau
  // mot de passe et confirmation côte à côte.
  const fields = (
    <View style={{ gap: m.gap * 0.5 }}>
      {field(FIELDS[0]!, 0)}
      <View style={[styles.pair, { gap: m.gap * 0.6 }]}>
        {field(FIELDS[1]!, 1)}
        {field(FIELDS[2]!, 2)}
      </View>
      {formError ? (
        <Text
          style={[styles.error, message]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {formError}
        </Text>
      ) : null}
    </View>
  );
  // Annuler : secondaire et discret ; Enregistrer : action principale (émeraude et laiton).
  const actions = (
    <View style={[styles.actions, { gap: m.gap }]}>
      <PanelButton title="Annuler" tone="quiet" disabled={change.isPending} onPress={onCancel} />
      <PanelButton
        title="Enregistrer"
        tone="primary"
        accessibilityLabel="Enregistrer le nouveau mot de passe"
        loading={change.isPending}
        onPress={submit}
      />
    </View>
  );
  const reset = () => {
    setValues(EMPTY);
    setErrors({});
    setFormError(null);
  };
  return { fields, actions, reset };
}

const styles = StyleSheet.create({
  label: { color: salon.textSoft },
  field: { flex: 1, minWidth: 0 },
  pair: { flexDirection: 'row', alignItems: 'flex-start' },
  error: { color: '#FF8A7A', fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
});
