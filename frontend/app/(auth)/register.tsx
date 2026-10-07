import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/ui/Button';
import { TextField } from '../../src/components/ui/TextField';
import { colors, spacing } from '../../src/constants/theme';
import { AuthScreen, FieldColumn, FieldRow, FormBanner } from '../../src/features/auth/AuthScreen';
import { useRegister } from '../../src/features/auth/hooks';
import {
  normalizePhone,
  validateCredentialsStep,
  validateIdentityStep,
} from '../../src/features/auth/validation';
import { ApiError } from '../../src/lib/api-client';
import type { RegisterPayload } from '../../src/types/auth';

type Field = keyof RegisterPayload;
const IDENTITY_FIELDS: readonly Field[] = ['firstName', 'lastName', 'username'];

const EMPTY: RegisterPayload = {
  firstName: '',
  lastName: '',
  username: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
};

/** Inscription en 2 étapes (R-15) : identité, puis identifiants et téléphone. */
export default function RegisterScreen() {
  const [step, setStep] = useState<1 | 2>(1);
  const [values, setValues] = useState<RegisterPayload>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const register = useRegister();

  const field = (name: Field) => ({
    value: values[name],
    error: errors[name],
    onChangeText: (text: string) => {
      setValues((v) => ({ ...v, [name]: text }));
      setErrors((e) => ({ ...e, [name]: undefined }));
    },
  });

  const next = () => {
    const found = validateIdentityStep(values);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(2);
  };

  const submit = () => {
    const found = validateCredentialsStep(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    register.mutate(
      { ...values, phone: normalizePhone(values.phone), email: values.email.trim() },
      {
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
            setErrors(err.fields as Partial<Record<Field, string>>);
            // Un pseudo déjà pris se corrige à l'étape 1.
            if (IDENTITY_FIELDS.some((f) => err.fields[f])) setStep(1);
          }
        },
      },
    );
  };

  const failure =
    register.error instanceof ApiError && Object.keys(register.error.fields).length === 0
      ? register.error.message
      : undefined;

  return (
    <AuthScreen
      title="Créer un compte"
      subtitle={step === 1 ? 'Comment vous appelle-t-on ?' : 'Vos accès et votre téléphone.'}
    >
      <Text style={styles.step}>Étape {step} sur 2</Text>
      <View style={styles.progress}>
        <View style={[styles.progressBar, { width: step === 1 ? '50%' : '100%' }]} />
      </View>

      {register.isSuccess ? (
        <FormBanner tone="success" message="Compte créé ! Connexion en cours…" />
      ) : null}
      {failure ? <FormBanner tone="error" message={failure} /> : null}

      {step === 1 ? (
        <>
          <FieldRow>
            <FieldColumn>
              <TextField
                label="Prénom"
                autoComplete="given-name"
                textContentType="givenName"
                {...field('firstName')}
              />
            </FieldColumn>
            <FieldColumn>
              <TextField
                label="Nom"
                autoComplete="family-name"
                textContentType="familyName"
                {...field('lastName')}
              />
            </FieldColumn>
          </FieldRow>
          <TextField
            label="Pseudo"
            hint="Votre nom visible en jeu (3 à 20 lettres, chiffres ou « _ »)."
            autoCapitalize="none"
            autoComplete="username"
            {...field('username')}
          />
          <Button title="Continuer →" onPress={next} />
        </>
      ) : (
        <>
          <FieldRow>
            <FieldColumn>
              <TextField
                label="Email"
                placeholder="vous@exemple.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                {...field('email')}
              />
            </FieldColumn>
            <FieldColumn>
              <TextField
                label="Téléphone"
                placeholder="+ indicatif pays et numéro"
                hint="Format international, ex. +XXX XX XX XX XX."
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                {...field('phone')}
              />
            </FieldColumn>
          </FieldRow>
          <FieldRow>
            <FieldColumn>
              <TextField
                label="Mot de passe"
                hint="8 caractères minimum, avec au moins une lettre et un chiffre."
                secret
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                {...field('password')}
              />
            </FieldColumn>
            <FieldColumn>
              <TextField
                label="Confirmer le mot de passe"
                secret
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                {...field('confirmPassword')}
              />
            </FieldColumn>
          </FieldRow>
          <Button title="Créer mon compte" onPress={submit} loading={register.isPending} />
          <View style={styles.back}>
            <Button
              title="← Retour"
              variant="link"
              disabled={register.isPending}
              onPress={() => setStep(1)}
            />
          </View>
        </>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>Déjà un compte ?</Text>
        <Button
          title="Se connecter"
          variant="link"
          disabled={register.isPending}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
        />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  step: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm },
  progress: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  progressBar: { height: 4, backgroundColor: colors.gold },
  back: { alignItems: 'center', marginTop: spacing.sm },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  footerText: { color: colors.textMuted, fontSize: 15 },
});
