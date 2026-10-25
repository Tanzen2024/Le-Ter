import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { salon } from '../../constants/theme';
import { TextField } from '../../components/ui/TextField';
import { useRegenerateRecoveryCode } from '../auth/hooks';
import { RecoveryCodeCard } from '../auth/RecoveryCodeCard';
import { ApiError } from '../../lib/api-client';
import { useLobbyMetrics } from './lobby-metrics';
import { PanelButton } from './LobbyUi';

/**
 * Profil → code de récupération (D-135) : un nouveau code, après le mot de passe actuel.
 * L'ancien code cesse aussitôt de fonctionner ; le nouveau n'est affiché qu'ici, une fois.
 * Sert aussi aux comptes créés avant les codes, qui n'en ont pas encore.
 */
export function RecoveryCodeSection({
  hasCode,
  onExpandedChange,
}: {
  hasCode: boolean;
  /** Saisie ou code affiché (`true`), ou simple bouton (`false`) : le panneau lui fait place. */
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const m = useLobbyMetrics();
  const regenerate = useRegenerateRecoveryCode();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const code = regenerate.data?.recoveryCode;
  const expanded = open || Boolean(code);
  useEffect(() => onExpandedChange?.(expanded), [expanded, onExpandedChange]);

  const close = () => {
    setOpen(false);
    setPassword('');
    setError(undefined);
    regenerate.reset();
  };

  if (code) {
    return <RecoveryCodeCard code={code} onConfirm={close} />;
  }
  if (!open) {
    return (
      <View style={styles.start}>
        <PanelButton
          title={hasCode ? 'Nouveau code' : 'Créer un code'}
          accessibilityLabel={
            hasCode ? 'Générer un nouveau code de récupération' : 'Créer un code de récupération'
          }
          onPress={() => setOpen(true)}
        />
      </View>
    );
  }

  const submit = () => {
    if (!password) {
      setError('Saisissez votre mot de passe actuel.');
      return;
    }
    regenerate.mutate(password, {
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur, réessayez.'),
    });
  };

  return (
    <View style={{ gap: m.gap * 0.5 }}>
      <Text style={[styles.text, { fontSize: m.smallSize }]}>
        {hasCode
          ? 'Votre code actuel cessera de fonctionner et un nouveau code vous sera affiché.'
          : 'Un code vous sera affiché : il vous permettra de récupérer votre compte.'}
      </Text>
      <TextField
        appearance="table"
        label="Mot de passe actuel"
        controlHeight={m.controlHeight * 0.9}
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError(undefined);
        }}
        error={error}
        editable={!regenerate.isPending}
        secret
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {error ? (
        <Text style={[styles.error, { fontSize: m.smallSize }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <View style={[styles.row, { gap: m.gap * 0.5 }]}>
        <PanelButton title="Annuler" tone="danger" onPress={close} />
        <PanelButton title="Afficher le code" loading={regenerate.isPending} onPress={submit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', justifyContent: 'flex-end' },
  text: { color: salon.textSoft },
  error: { color: '#FF8A7A', fontWeight: '600' },
});
