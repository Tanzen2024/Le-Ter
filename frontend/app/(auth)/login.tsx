import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../src/components/ui/Button';
import { TextField } from '../../src/components/ui/TextField';
import { spacing } from '../../src/constants/theme';
import { AuthScreen, FieldColumn, FieldRow, FormBanner } from '../../src/features/auth/AuthScreen';
import { useLogin } from '../../src/features/auth/hooks';
import { ApiError } from '../../src/lib/api-client';

type Field = 'email' | 'password';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const passwordRef = useRef<TextInput>(null);
  const login = useLogin();

  const submit = () => {
    const next: Partial<Record<Field, string>> = {};
    if (!email.trim()) next.email = 'Saisissez votre email.';
    if (!password) next.password = 'Saisissez votre mot de passe.';
    setErrors(next);
    if (Object.keys(next).length === 0) {
      login.mutate({ email: email.trim(), password });
    }
  };

  // Message générique du serveur (« Email ou mot de passe incorrect. ») : il ne
  // révèle pas si le compte existe.
  const failure = login.error instanceof ApiError ? login.error.message : undefined;

  return (
    <AuthScreen title="Bon retour 👋" subtitle="Connectez-vous pour rejoindre une table.">
      {failure ? <FormBanner tone="error" message={failure} /> : null}
      <FieldRow>
        <FieldColumn>
          <TextField
            label="Email"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setErrors((e) => ({ ...e, email: undefined }));
            }}
            error={errors.email}
            placeholder="vous@exemple.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        </FieldColumn>
        <FieldColumn>
          <TextField
            ref={passwordRef}
            label="Mot de passe"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setErrors((e) => ({ ...e, password: undefined }));
            }}
            error={errors.password}
            secret
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </FieldColumn>
      </FieldRow>
      <View style={styles.forgot}>
        <Button
          title="Mot de passe oublié ?"
          variant="link"
          onPress={() =>
            Alert.alert(
              'Mot de passe oublié',
              'La réinitialisation du mot de passe sera bientôt disponible.',
            )
          }
        />
      </View>
      <FieldRow>
        <FieldColumn>
          <Button
            title="Créer un compte"
            variant="secondary"
            disabled={login.isPending}
            onPress={() => router.push('/register')}
          />
        </FieldColumn>
        <FieldColumn>
          <Button title="Se connecter" onPress={submit} loading={login.isPending} />
        </FieldColumn>
      </FieldRow>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  forgot: { alignItems: 'flex-end', marginTop: -spacing.sm, marginBottom: spacing.md },
});
