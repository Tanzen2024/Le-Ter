import { router } from 'expo-router';
import { useRef, useState, type RefObject } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { TextField } from '../../src/components/ui/TextField';
import { useLogin } from '../../src/features/auth/hooks';
import {
  LoginTable,
  TableButton,
  TableFooter,
  TableLink,
  TableMessage,
  TableTitle,
  useLoginTableMetrics,
} from '../../src/features/auth/LoginTable';
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
    <LoginTable>
      <TableTitle>Connexion</TableTitle>
      <LoginFields
        email={email}
        password={password}
        errors={errors}
        passwordRef={passwordRef}
        onEmailChange={(v) => {
          setEmail(v);
          setErrors((e) => ({ ...e, email: undefined }));
        }}
        onPasswordChange={(v) => {
          setPassword(v);
          setErrors((e) => ({ ...e, password: undefined }));
        }}
        onSubmit={submit}
      />
      {/* R-35 (docs/TODO.md) : aucun flux de réinitialisation n'est défini, seul le point d'entrée existe. */}
      <TableLink
        title="Mot de passe oublié ?"
        style={styles.forgot}
        onPress={() =>
          Alert.alert(
            'Mot de passe oublié',
            'La réinitialisation du mot de passe sera bientôt disponible.',
          )
        }
      />
      <TableMessage message={errors.email ?? errors.password ?? failure} />
      <TableButton title="Se connecter" onPress={submit} loading={login.isPending} />
      {/* L'inscription est un écran distinct de la pile (auth) : jamais affichée ici. */}
      <TableFooter
        prompt="Vous n'avez pas de compte ?"
        linkTitle="S'inscrire"
        disabled={login.isPending}
        onPress={() => router.push('/register')}
      />
    </LoginTable>
  );
}

/** Champs Email et Mot de passe, à la hauteur du bouton (lue dans le gabarit de la table). */
function LoginFields({
  email,
  password,
  errors,
  passwordRef,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  email: string;
  password: string;
  errors: Partial<Record<Field, string>>;
  passwordRef: RefObject<TextInput | null>;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { controlHeight, inputFontSize, gap } = useLoginTableMetrics();
  const field = { appearance: 'table', controlHeight, style: { fontSize: inputFontSize } } as const;
  return (
    <View style={{ gap }}>
      <TextField
        {...field}
        label="Email"
        value={email}
        onChangeText={onEmailChange}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        {...field}
        ref={passwordRef}
        label="Mot de passe"
        value={password}
        onChangeText={onPasswordChange}
        error={errors.password}
        secret
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: 'center', marginTop: 2, marginBottom: 4 },
});
