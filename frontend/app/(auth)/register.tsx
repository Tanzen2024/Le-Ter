import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';

import { tablePalette as palette } from '../../src/components/table/TableDecor';
import { CountrySelectField } from '../../src/components/ui/CountrySelectField';
import { TextField } from '../../src/components/ui/TextField';
import { AFTER_ICON, FieldIcon, LockIcon, UserIcon } from '../../src/features/auth/AuthIcons';
import { useLogin, useRegister } from '../../src/features/auth/hooks';
import {
  LoginButton,
  LoginFooter,
  LoginLayout,
  LoginLink,
  LoginMessage,
  LoginSteps,
  useLoginMetrics,
} from '../../src/features/auth/LoginLayout';
import { RecoveryCodeCard } from '../../src/features/auth/RecoveryCodeCard';
import {
  normalizeReferralInput,
  referralCodeProblem,
  validateCredentialsStep,
  validateIdentityStep,
} from '../../src/features/auth/validation';
import { ApiError } from '../../src/lib/api-client';
import {
  DEFAULT_PHONE_COUNTRY,
  phonePlaceholder,
  sanitizeNationalInput,
} from '../../src/lib/phone-countries';
import type { RegisterPayload } from '../../src/types/auth';

type Field = Exclude<keyof RegisterPayload, 'referralSource'>;
type Values = Omit<RegisterPayload, 'referralCode' | 'referralSource'> & { referralCode: string };
const IDENTITY_FIELDS: readonly Field[] = ['firstName', 'lastName', 'username', 'referralCode'];

const STEPS = ['Identité', 'Accès et téléphone'] as const;

const EMPTY: Values = {
  firstName: '',
  lastName: '',
  username: '',
  email: '',
  country: DEFAULT_PHONE_COUNTRY,
  phone: '',
  password: '',
  confirmPassword: '',
  referralCode: '',
};

/** `?ref=` d'un lien d'invitation (leter://register?ref=CODE) : caractères de code seulement. */
function referralFromLink(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return normalizeReferralInput(value ?? '').replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/**
 * Inscription en 2 étapes (R-15), sur le modèle de la connexion (D-139) : même panneau, mêmes
 * champs et même téléphone (indicatif dans le champ, Cameroun présélectionné et modifiable,
 * numéro national seul). Étape 1 : identité ; étape 2 : email facultatif (D-135), téléphone,
 * mot de passe. Compte créé : le code de récupération s'affiche une fois, puis le joueur est
 * connecté quand il l'a enregistré.
 */
export default function RegisterScreen() {
  const params = useLocalSearchParams<{ ref?: string }>();
  const [step, setStep] = useState<1 | 2>(1);
  // Parrainage (D-161) : prérempli par le lien quand l'application l'a reçu, sinon saisi.
  const [linkedCode] = useState(() => referralFromLink(params.ref));
  const [values, setValues] = useState<Values>(() => ({ ...EMPTY, referralCode: linkedCode }));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const register = useRegister();
  const login = useLogin();
  // Code reçu à l'inscription (D-135) : en mémoire de l'écran seulement, affiché une fois.
  const recoveryCode = register.data?.recoveryCode;
  const appear = useStepTransition(step);

  const edit = (name: Field, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  // Nouveau pays : l'ancien numéro (validé pour un autre indicatif) est effacé.
  const chooseCountry = (code: string) => {
    if (code === values.country) return;
    setValues((v) => ({ ...v, country: code, phone: '' }));
    setErrors((e) => ({ ...e, country: undefined, phone: undefined }));
  };

  const next = () => {
    const found: Partial<Record<Field, string>> = validateIdentityStep(values);
    const referral = referralCodeProblem(values.referralCode);
    if (referral) found.referralCode = referral;
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(2);
  };

  const submit = () => {
    const found = validateCredentialsStep(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const { referralCode: rawCode, ...rest } = values;
    const referralCode = normalizeReferralInput(rawCode);
    register.mutate(
      {
        ...rest,
        // Numéro national seul : le serveur reconstruit le numéro international du pays.
        phone: values.phone.replace(/[\s.()-]/g, ''),
        email: values.email.trim(),
        // Aucun code : aucun champ envoyé. Code du lien inchangé : origine LINK.
        ...(referralCode && {
          referralCode,
          referralSource: referralCode === linkedCode ? ('LINK' as const) : ('MANUAL' as const),
        }),
      },
      {
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
            setErrors(err.fields as Partial<Record<Field, string>>);
            // Un pseudo déjà pris ou un code de parrainage refusé se corrigent à l'étape 1.
            if (IDENTITY_FIELDS.some((f) => err.fields[f])) setStep(1);
          }
        },
      },
    );
  };

  // Code enregistré : connexion par téléphone (le compte n'a peut-être aucun email).
  const enter = () =>
    login.mutate({
      country: values.country,
      phone: values.phone.replace(/[\s.()-]/g, ''),
      password: values.password,
    });

  const failure =
    register.error instanceof ApiError && Object.keys(register.error.fields).length === 0
      ? register.error.message
      : login.error instanceof ApiError
        ? login.error.message
        : undefined;

  if (recoveryCode) {
    return (
      <LoginLayout title="Compte créé" wide decorated>
        <Text style={styles.lead}>Dernière étape : enregistrez votre code de récupération.</Text>
        <LoginMessage message={failure} />
        <RecoveryCodeCard code={recoveryCode} onConfirm={enter} confirming={login.isPending} />
      </LoginLayout>
    );
  }

  return (
    <LoginLayout title="Inscription" wide decorated>
      <LoginSteps steps={STEPS} current={step} />
      <LoginMessage message={failure} />
      <Animated.View style={appear}>
        {step === 1 ? (
          <IdentityStep values={values} errors={errors} onEdit={edit} onNext={next} />
        ) : (
          <CredentialsStep
            values={values}
            errors={errors}
            busy={register.isPending}
            onEdit={edit}
            onCountryChange={chooseCountry}
            onSubmit={submit}
            onBack={() => setStep(1)}
          />
        )}
      </Animated.View>
      {/* Retour à l'écran de connexion (qui précède dans la pile (auth)). */}
      <LoginFooter
        prompt="Déjà un compte ?"
        linkTitle="Se connecter"
        disabled={register.isPending}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      />
    </LoginLayout>
  );
}

interface StepProps {
  values: Values;
  errors: Partial<Record<Field, string>>;
  onEdit: (name: Field, value: string) => void;
}

/** Champs au format de la connexion, avec l'erreur (et l'aide au focus) sous chacun. */
function useFieldProps({ values, errors, onEdit }: StepProps) {
  const { controlHeight, inputFontSize } = useLoginMetrics();
  return (name: Field) => ({
    appearance: 'login' as const,
    messages: true,
    controlHeight,
    style: { fontSize: inputFontSize },
    value: values[name],
    error: errors[name],
    onChangeText: (text: string) => onEdit(name, text),
  });
}

/** Deux champs côte à côte (panneau large de l'inscription). */
function Row({ children }: { children: ReactNode }) {
  const { gap } = useLoginMetrics();
  return <View style={[styles.row, { gap, marginBottom: gap }]}>{children}</View>;
}

function Column({ children }: { children: ReactNode }) {
  return <View style={styles.column}>{children}</View>;
}

function IdentityStep({ onNext, ...props }: StepProps & { onNext: () => void }) {
  const field = useFieldProps(props);
  const { gap } = useLoginMetrics();
  return (
    <>
      <Row>
        <Column>
          <TextField
            label="Prénom"
            placeholder="Prénom"
            autoComplete="given-name"
            textContentType="givenName"
            {...field('firstName')}
            leading={
              <FieldIcon>
                <UserIcon />
              </FieldIcon>
            }
            style={[field('firstName').style, AFTER_ICON]}
          />
        </Column>
        <Column>
          <TextField
            label="Nom"
            placeholder="Nom"
            autoComplete="family-name"
            textContentType="familyName"
            {...field('lastName')}
            leading={
              <FieldIcon>
                <UserIcon />
              </FieldIcon>
            }
            style={[field('lastName').style, AFTER_ICON]}
          />
        </Column>
      </Row>
      <View style={[styles.row, { gap, marginBottom: gap * 1.5 }]}>
        <Column>
          <TextField
            label="Pseudo"
            placeholder="Pseudo"
            leading={
              <FieldIcon>
                <UserIcon />
              </FieldIcon>
            }
            hint="Votre nom visible en jeu (3 à 20 lettres, chiffres ou « _ »)."
            autoCapitalize="none"
            autoComplete="username"
            {...field('username')}
            style={[field('username').style, AFTER_ICON]}
          />
        </Column>
        <Column>
          {/* Parrainage (D-161) : facultatif, vérifié par le serveur avant la création du compte. */}
          <TextField
            label="Code de parrainage"
            placeholder="Code de parrainage (facultatif)"
            hint="Facultatif. Le code personnel de la personne qui vous a invité."
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            {...field('referralCode')}
          />
        </Column>
      </View>
      <LoginButton title="Continuer" onPress={onNext} />
    </>
  );
}

function CredentialsStep({
  busy,
  onCountryChange,
  onSubmit,
  onBack,
  ...props
}: StepProps & {
  busy: boolean;
  onCountryChange: (code: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const field = useFieldProps(props);
  const { gap, controlHeight } = useLoginMetrics();
  const { values, errors, onEdit } = props;
  return (
    <>
      <Row>
        <Column>
          <TextField
            label="Email"
            placeholder="Adresse e-mail (facultatif)"
            hint="Facultatif. Votre téléphone suffit pour vous connecter."
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            {...field('email')}
          />
        </Column>
        <Column>
          {/* Comme la connexion : [ 🇨🇲 +237 ▾ ] (bloc distinct, pays modifiable) puis le numéro. */}
          <View style={[styles.phoneRow, { gap: gap / 2 }]}>
            <View style={styles.country}>
              <CountrySelectField
                appearance="login"
                flag
                controlHeight={controlHeight}
                label="Indicatif du pays"
                value={values.country}
                onChange={onCountryChange}
              />
            </View>
            <View style={styles.column}>
              <TextField
                label="Téléphone"
                placeholder={phonePlaceholder(values.country) ?? 'Numéro national'}
                {...field('phone')}
                style={[field('phone').style, AFTER_ICON, styles.phoneInput]}
                error={errors.country ?? errors.phone}
                onChangeText={(text) => onEdit('phone', sanitizeNationalInput(text))}
                leading={
                  <FieldIcon>
                    <UserIcon />
                  </FieldIcon>
                }
                keyboardType="phone-pad"
                autoComplete="tel-national"
                textContentType="telephoneNumber"
              />
            </View>
          </View>
        </Column>
      </Row>
      <Row>
        <Column>
          <TextField
            label="Mot de passe"
            placeholder="Mot de passe"
            hint="8 caractères minimum, avec au moins une lettre et un chiffre."
            secret
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            {...field('password')}
            leading={
              <FieldIcon>
                <LockIcon />
              </FieldIcon>
            }
            style={[field('password').style, AFTER_ICON]}
          />
        </Column>
        <Column>
          <TextField
            label="Confirmer le mot de passe"
            placeholder="Confirmation"
            secret
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            {...field('confirmPassword')}
            leading={
              <FieldIcon>
                <LockIcon />
              </FieldIcon>
            }
            style={[field('confirmPassword').style, AFTER_ICON]}
          />
        </Column>
      </Row>
      <View style={{ marginTop: gap / 2 }}>
        <LoginButton
          title="Créer mon compte"
          busyTitle="Création du compte…"
          onPress={onSubmit}
          loading={busy}
        />
      </View>
      <View style={[styles.back, { marginTop: gap / 2 }]}>
        <LoginLink title="← Retour" onPress={onBack} disabled={busy} />
      </View>
    </>
  );
}

/**
 * Changement d'étape : léger fondu avec un glissement de quelques points (180 ms), rien si
 * l'utilisateur a demandé de réduire les animations. Jamais à l'ouverture de l'écran : le
 * formulaire, déjà affiché, disparaissait puis glissait (l'écran semblait trembler en arrivant).
 */
function useStepTransition(step: 1 | 2) {
  const [value] = useState(() => new Animated.Value(1));
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
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
  lead: { color: palette.cream, opacity: 0.85, textAlign: 'center', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
  // Indicatif en haut de la ligne : le message d'erreur du téléphone s'affiche sous le champ.
  phoneRow: { flexDirection: 'row', alignItems: 'flex-start' },
  country: { flexShrink: 0 },
  phoneInput: { textAlign: 'left' },
  back: { alignItems: 'center' },
});
