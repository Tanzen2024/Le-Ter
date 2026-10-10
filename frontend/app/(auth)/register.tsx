import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/ui/Button';
import { CountrySelectField } from '../../src/components/ui/CountrySelectField';
import { TextField } from '../../src/components/ui/TextField';
import { colors, spacing } from '../../src/constants/theme';
import {
  AuthFooter,
  authPalette,
  AuthScreen,
  FieldColumn,
  FieldRow,
  FormBanner,
  useDenseAuthLayout,
} from '../../src/features/auth/AuthScreen';
import { useRegister } from '../../src/features/auth/hooks';
import { validateCredentialsStep, validateIdentityStep } from '../../src/features/auth/validation';
import { ApiError } from '../../src/lib/api-client';
import {
  findPhoneCountry,
  nationalExample,
  sanitizeNationalInput,
} from '../../src/lib/phone-countries';
import type { RegisterPayload } from '../../src/types/auth';

type Field = keyof RegisterPayload;
const IDENTITY_FIELDS: readonly Field[] = ['firstName', 'lastName', 'username'];

const STEPS = ['Identité', 'Accès et téléphone'] as const;

const EMPTY: RegisterPayload = {
  firstName: '',
  lastName: '',
  username: '',
  email: '',
  country: '',
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
  const dense = useDenseAuthLayout();
  const appear = useStepTransition(step);

  const field = (name: Field) => ({
    dense,
    appearance: 'soft' as const,
    value: values[name],
    error: errors[name],
    onChangeText: (text: string) => {
      setValues((v) => ({ ...v, [name]: text }));
      setErrors((e) => ({ ...e, [name]: undefined }));
    },
  });

  // Nouveau pays : l'ancien numéro (validé pour un autre indicatif) est effacé.
  const chooseCountry = (code: string) => {
    if (code === values.country) return;
    setValues((v) => ({ ...v, country: code, phone: '' }));
    setErrors((e) => ({ ...e, country: undefined, phone: undefined }));
  };
  const country = values.country ? findPhoneCountry(values.country) : undefined;

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
      {
        ...values,
        // Numéro national seul : le serveur reconstruit le numéro international du pays.
        phone: values.phone.replace(/[\s.()-]/g, ''),
        email: values.email.trim(),
      },
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
      formTitle="Inscription"
      subtitle={step === 1 ? 'Comment vous appelle-t-on ?' : 'Vos accès et votre téléphone.'}
      steps={STEPS}
      currentStep={step}
    >
      <View
        style={styles.stepHeader}
        accessible
        accessibilityLabel={`Étape ${step} sur 2 : ${STEPS[step - 1]}`}
      >
        <Text style={styles.step}>
          Étape {step} sur 2 · <Text style={styles.stepName}>{STEPS[step - 1]}</Text>
        </Text>
        <View style={styles.progress}>
          {STEPS.map((label, index) => (
            <View
              key={label}
              style={[styles.progressSegment, index < step && styles.progressSegmentOn]}
            />
          ))}
        </View>
      </View>

      {register.isSuccess ? (
        <FormBanner tone="success" message="Compte créé ! Connexion en cours…" />
      ) : null}
      {failure ? <FormBanner tone="error" message={failure} /> : null}

      <Animated.View style={appear}>
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
            <TextField
              label="Email"
              placeholder="vous@exemple.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              {...field('email')}
            />
            {/* Pays d'abord : il fixe l'indicatif (non modifiable) et le format du numéro. */}
            <FieldRow>
              <FieldColumn>
                <CountrySelectField
                  label="Pays"
                  placeholder="Sélectionnez votre pays"
                  value={values.country}
                  onChange={chooseCountry}
                  error={errors.country}
                  dense={dense}
                />
              </FieldColumn>
              <FieldColumn>
                <TextField
                  label="Téléphone"
                  {...field('phone')}
                  onChangeText={(text) => {
                    setValues((v) => ({ ...v, phone: sanitizeNationalInput(text) }));
                    setErrors((e) => ({ ...e, phone: undefined }));
                  }}
                  editable={Boolean(country)}
                  prefix={country?.dialCode}
                  prefixAccessibilityLabel={
                    country ? `Indicatif ${country.dialCode}, non modifiable` : undefined
                  }
                  placeholder={
                    country
                      ? (nationalExample(country.code) ?? 'Numéro national')
                      : "Sélectionnez d'abord votre pays"
                  }
                  hint={country ? 'Numéro national, sans l’indicatif.' : undefined}
                  keyboardType="phone-pad"
                  autoComplete="tel-national"
                  textContentType="telephoneNumber"
                />
              </FieldColumn>
            </FieldRow>
            <TextField
              label="Mot de passe"
              hint="8 caractères minimum, avec au moins une lettre et un chiffre."
              secret
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              {...field('password')}
            />
            <TextField
              label="Confirmer le mot de passe"
              secret
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              {...field('confirmPassword')}
            />
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
      </Animated.View>

      {/* Retour à l'écran de connexion (qui précède dans la pile (auth)). */}
      <AuthFooter
        prompt="Déjà un compte ?"
        linkTitle="Se connecter"
        disabled={register.isPending}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      />
    </AuthScreen>
  );
}

/**
 * Changement d'étape : léger fondu avec un glissement de quelques points (180 ms), rien si
 * l'utilisateur a demandé de réduire les animations.
 */
function useStepTransition(step: 1 | 2) {
  const [value] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce) return;
        value.setValue(0);
        animation = Animated.timing(value, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        });
        animation.start();
      });
    return () => {
      cancelled = true;
      animation?.stop();
      value.setValue(1);
    };
  }, [step, value]);
  return {
    opacity: value,
    transform: [
      {
        translateX: value.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };
}

const styles = StyleSheet.create({
  stepHeader: { marginBottom: spacing.md },
  step: {
    color: authPalette.muted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  stepName: { color: colors.feltLight },
  progress: { flexDirection: 'row', gap: 6 },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: authPalette.track,
  },
  progressSegmentOn: { backgroundColor: colors.gold },
  back: { alignItems: 'center', marginTop: spacing.xs },
});
