import { router } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { tablePalette as palette } from '../../src/components/table/TableDecor';
import { TextField } from '../../src/components/ui/TextField';
import { AFTER_ICON, FieldIcon, LockIcon } from '../../src/features/auth/AuthIcons';
import { useResetPassword, useVerifyRecovery } from '../../src/features/auth/hooks';
import { IdentifierField } from '../../src/features/auth/IdentifierField';
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
  resolveLoginIdentifier,
  validateNewPassword,
  type LoginCredentials,
} from '../../src/features/auth/validation';
import { ApiError } from '../../src/lib/api-client';
import { DEFAULT_PHONE_COUNTRY } from '../../src/lib/phone-countries';

const STEPS = ['Identifiant', 'Code', 'Nouveau mot de passe'] as const;
type Step = 1 | 2 | 3;
type Field = 'country' | 'phone' | 'code' | 'newPassword' | 'confirmPassword';

/**
 * « Mot de passe oublié ? » (D-135), sans SMS, au modèle de la connexion (D-139, D-141) : même
 * décor et même ligne [ 🇨🇲 +237 ▾ ] [ 👤 Téléphone ou email ] (D-142 : numéro, Cameroun
 * présélectionné et modifiable, ou e-mail du compte) → code de récupération (vérifié par le
 * serveur, qui donne une autorisation temporaire) → nouveau mot de passe → NOUVEAU code,
 * affiché une fois → connexion. Le numéro seul ne permet jamais de réinitialiser. Le message
 * d'échec du serveur est le même que le numéro existe ou non.
 */
export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<Step>(1);
  const [country, setCountry] = useState(DEFAULT_PHONE_COUNTRY);
  const [phone, setPhone] = useState('');
  // Compte visé, résolu à l'étape 1 : `{ email }` ou `{ country, phone }` (comme la connexion).
  const [account, setAccount] = useState<LoginCredentials>();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  // Autorisation et nouveau code : en mémoire de l'écran seulement, jamais stockés.
  const [resetToken, setResetToken] = useState<string>();
  const verify = useVerifyRecovery();
  const reset = useResetPassword();
  const newCode = reset.data?.recoveryCode;

  const clear = (field: Field) => setErrors((e) => ({ ...e, [field]: undefined }));
  const backToLogin = () => (router.canGoBack() ? router.back() : router.replace('/login'));

  const continueWithPhone = () => {
    const resolved = resolveLoginIdentifier(country, phone);
    if ('error' in resolved) {
      setErrors({ phone: resolved.error });
      return;
    }
    setErrors({});
    setAccount(resolved.credentials);
    setStep(2);
  };

  const checkCode = () => {
    if (!account) return;
    if (!code.trim()) {
      setErrors({ code: 'Saisissez votre code de récupération.' });
      return;
    }
    verify.mutate(
      { ...account, code: code.trim() },
      {
        onSuccess: (grant) => {
          setResetToken(grant.resetToken);
          setStep(3);
        },
      },
    );
  };

  const submitPassword = () => {
    const found = validateNewPassword(newPassword, confirmPassword);
    setErrors(found);
    if (Object.keys(found).length > 0 || !resetToken) return;
    reset.mutate({ resetToken, newPassword, confirmPassword });
  };

  const failure =
    step === 2 && verify.error instanceof ApiError
      ? verify.error.message
      : step === 3 && reset.error instanceof ApiError
        ? reset.error.message
        : undefined;
  // Autorisation expirée ou déjà utilisée : on recommence à l'étape du code.
  const grantExpired =
    reset.error instanceof ApiError && reset.error.code === 'RESET_GRANT_INVALID';

  if (newCode) {
    return (
      <LoginLayout title="Mot de passe modifié" wide decorated>
        <LoginMessage
          tone="success"
          message="Mot de passe modifié avec succès. Vous pouvez maintenant vous connecter."
        />
        <Text style={styles.text}>
          Votre ancien code de récupération ne fonctionne plus. Voici le nouveau :
        </Text>
        <RecoveryCodeCard
          code={newCode}
          title="Nouveau code de récupération"
          confirmTitle="Se connecter"
          onConfirm={() => router.replace('/login')}
        />
      </LoginLayout>
    );
  }

  return (
    <LoginLayout title="Mot de passe oublié ?" decorated>
      <LoginSteps steps={STEPS} current={step} />
      <LoginMessage message={failure} />

      {step === 1 ? (
        <PhoneStep
          country={country}
          phone={phone}
          error={errors.country ?? errors.phone}
          onCountryChange={(next) => {
            if (next !== country) setPhone('');
            setCountry(next);
            setErrors((e) => ({ ...e, country: undefined, phone: undefined }));
          }}
          onPhoneChange={(text) => {
            setPhone(text);
            clear('phone');
          }}
          onContinue={continueWithPhone}
        />
      ) : null}

      {step === 2 ? (
        <Fields>
          <Text style={styles.text}>
            Saisissez le code de récupération fourni lors de la création de votre compte.
          </Text>
          <LoginField
            label="Code"
            placeholder="LT-XXXX-XXXX-XXXX"
            value={code}
            error={errors.code}
            onChangeText={(text) => {
              setCode(text);
              clear('code');
              verify.reset();
            }}
            autoCapitalize="characters"
            autoComplete="off"
            returnKeyType="go"
            onSubmitEditing={checkCode}
          />
          <LoginButton
            title="Vérifier"
            busyTitle="Vérification…"
            onPress={checkCode}
            loading={verify.isPending}
          />
          <Text style={styles.text}>
            Code perdu ? Contactez l’assistance Le Ter : elle pourra vous en remettre un nouveau
            après vérification.
          </Text>
          <View style={styles.back}>
            <LoginLink
              title="← Modifier le téléphone ou l’email"
              disabled={verify.isPending}
              onPress={() => setStep(1)}
            />
          </View>
        </Fields>
      ) : null}

      {step === 3 ? (
        <Fields>
          <LoginField
            leading={
              <FieldIcon>
                <LockIcon />
              </FieldIcon>
            }
            label="Nouveau mot de passe"
            placeholder="Nouveau mot de passe"
            hint="8 caractères minimum, avec au moins une lettre et un chiffre."
            secret
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            value={newPassword}
            error={errors.newPassword}
            onChangeText={(text) => {
              setNewPassword(text);
              clear('newPassword');
            }}
          />
          <LoginField
            leading={
              <FieldIcon>
                <LockIcon />
              </FieldIcon>
            }
            label="Confirmer le nouveau mot de passe"
            placeholder="Confirmer le nouveau mot de passe"
            secret
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            value={confirmPassword}
            error={errors.confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              clear('confirmPassword');
            }}
          />
          <LoginButton
            title="Réinitialiser le mot de passe"
            busyTitle="Réinitialisation…"
            onPress={submitPassword}
            loading={reset.isPending}
          />
          {grantExpired ? (
            <View style={styles.back}>
              <LoginLink
                title="← Saisir à nouveau le code"
                onPress={() => {
                  reset.reset();
                  setResetToken(undefined);
                  setStep(2);
                }}
              />
            </View>
          ) : null}
        </Fields>
      ) : null}

      <LoginFooter
        prompt="Vous vous en souvenez ?"
        linkTitle="Se connecter"
        disabled={verify.isPending || reset.isPending}
        onPress={backToLogin}
      />
    </LoginLayout>
  );
}

/** Colonne de champs espacés comme ceux de la connexion. */
function Fields({ children }: { children: ReactNode }) {
  const { gap } = useLoginMetrics();
  return <View style={{ gap }}>{children}</View>;
}

/** Champ au format de la connexion, avec l'erreur (et l'aide au focus) sous le champ. */
function LoginField(props: ComponentProps<typeof TextField>) {
  const { controlHeight, inputFontSize } = useLoginMetrics();
  return (
    <TextField
      appearance="login"
      messages
      controlHeight={controlHeight}
      // Saisie juste après l'icône, comme sur la connexion et l'inscription.
      style={[{ fontSize: inputFontSize }, props.leading ? AFTER_ICON : null]}
      {...props}
    />
  );
}

/** Étape 1 : la même ligne d'identification que la connexion. */
function PhoneStep({
  country,
  phone,
  error,
  onCountryChange,
  onPhoneChange,
  onContinue,
}: {
  country: string;
  phone: string;
  error?: string;
  onCountryChange: (code: string) => void;
  onPhoneChange: (text: string) => void;
  onContinue: () => void;
}) {
  return (
    <Fields>
      <Text style={styles.text}>Téléphone ou adresse e-mail de votre compte.</Text>
      {/* Même ligne que la connexion : [ 🇨🇲 +237 ▾ ] [ 👤 Téléphone ou email ]. */}
      <IdentifierField
        messages
        country={country}
        value={phone}
        error={error}
        onCountryChange={onCountryChange}
        onChangeText={onPhoneChange}
        onSubmitEditing={onContinue}
      />
      <LoginButton title="Continuer" onPress={onContinue} />
    </Fields>
  );
}

const styles = StyleSheet.create({
  text: { color: palette.cream, opacity: 0.8, fontSize: 13, lineHeight: 18 },
  back: { alignItems: 'center' },
});
