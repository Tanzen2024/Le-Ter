import { router } from 'expo-router';
import { useRef, useState, type RefObject } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { TextField } from '../../src/components/ui/TextField';
import { AFTER_ICON, FieldIcon, LockIcon, LoginIcon } from '../../src/features/auth/AuthIcons';
import { useLogin } from '../../src/features/auth/hooks';
import { IdentifierField } from '../../src/features/auth/IdentifierField';
import {
  LoginButton,
  LoginFooter,
  LoginLayout,
  LoginLink,
  LoginMessage,
  useLoginMetrics,
} from '../../src/features/auth/LoginLayout';
import { resolveLoginIdentifier } from '../../src/features/auth/validation';
import { ApiError } from '../../src/lib/api-client';
import { DEFAULT_PHONE_COUNTRY } from '../../src/lib/phone-countries';

type Field = 'identifier' | 'password';

const UNEXPECTED_FAILURE = 'Connexion impossible pour le moment. Réessayez.';

/**
 * Connexion (D-135, D-139) : UN champ « téléphone ou e-mail » (pays présélectionné : Cameroun,
 * modifiable), le mot de passe, puis « Se connecter ». Le mode n'est jamais choisi par le
 * joueur : un « @ » ou une lettre en fait une adresse e-mail, sinon un numéro national.
 */
export default function LoginScreen() {
  const [country, setCountry] = useState(DEFAULT_PHONE_COUNTRY);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const passwordRef = useRef<TextInput>(null);
  // Verrou synchrone : deux appuis dans la même image n'envoient qu'une connexion.
  const sending = useRef(false);
  const login = useLogin();

  const ready = identifier.trim() !== '' && password !== '';

  const submit = () => {
    if (sending.current) return;
    const resolved = resolveLoginIdentifier(country, identifier);
    const next: Partial<Record<Field, string>> = {};
    if ('error' in resolved) next.identifier = resolved.error;
    if (!password) next.password = 'Saisissez votre mot de passe.';
    setErrors(next);
    if ('error' in resolved || next.password) return;
    sending.current = true;
    login.mutate(
      { ...resolved.credentials, password },
      {
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  const edit = (field: Field) => {
    setErrors((e) => ({ ...e, [field]: undefined }));
    if (login.isError) login.reset();
  };

  // Message générique du serveur (« … ou mot de passe incorrect. ») : il ne révèle pas si le
  // compte existe. Réseau coupé : message lisible d'`ApiError`. Jamais d'erreur technique brute.
  const failure = login.isError
    ? login.error instanceof ApiError
      ? login.error.message
      : UNEXPECTED_FAILURE
    : undefined;

  return (
    <LoginLayout title="CONNEXION" decorated>
      <LoginFields
        country={country}
        identifier={identifier}
        password={password}
        errors={errors}
        passwordRef={passwordRef}
        onCountryChange={(code) => {
          setCountry(code);
          edit('identifier');
        }}
        onIdentifierChange={(value) => {
          setIdentifier(value);
          edit('identifier');
        }}
        onPasswordChange={(value) => {
          setPassword(value);
          edit('password');
        }}
        onSubmit={submit}
      />
      <View style={styles.forgot}>
        <LoginLink title="Mot de passe oublié ?" onPress={() => router.push('/forgot-password')} />
      </View>
      <LoginMessage message={errors.identifier ?? errors.password ?? failure} />
      <LoginButton
        title="Se connecter"
        busyTitle="Connexion…"
        icon={<LoginIcon />}
        onPress={submit}
        loading={login.isPending}
        disabled={!ready}
      />
      {/* L'inscription est un écran distinct de la pile (auth) : jamais affichée ici. */}
      <LoginFooter
        prompt="Vous n'avez pas de compte ?"
        linkTitle="S'inscrire"
        disabled={login.isPending}
        onPress={() => router.push('/register')}
      />
    </LoginLayout>
  );
}

/** Identifiant (indicatif + téléphone, ou e-mail) et mot de passe, à la hauteur du bouton. */
function LoginFields({
  country,
  identifier,
  password,
  errors,
  passwordRef,
  onCountryChange,
  onIdentifierChange,
  onPasswordChange,
  onSubmit,
}: {
  country: string;
  identifier: string;
  password: string;
  errors: Partial<Record<Field, string>>;
  passwordRef: RefObject<TextInput | null>;
  onCountryChange: (code: string) => void;
  onIdentifierChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { controlHeight, inputFontSize, gap } = useLoginMetrics();
  const field = {
    appearance: 'login',
    controlHeight,
    style: { fontSize: inputFontSize, ...AFTER_ICON },
  } as const;
  return (
    <View style={{ gap }}>
      <IdentifierField
        country={country}
        value={identifier}
        error={errors.identifier}
        onCountryChange={onCountryChange}
        onChangeText={onIdentifierChange}
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        {...field}
        ref={passwordRef}
        label="Mot de passe"
        placeholder="Mot de passe"
        leading={
          <FieldIcon>
            <LockIcon />
          </FieldIcon>
        }
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
  forgot: { alignItems: 'flex-end', marginTop: 2, marginBottom: 4 },
});
