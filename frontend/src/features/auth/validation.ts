import type { RegisterPayload } from '../../types/auth';

/**
 * Validation inline, miroir des règles du serveur (backend/src/validators/auth.validators.ts).
 * Elle ne sert qu'à l'affichage : le serveur reste la seule autorité.
 */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

type IdentityField = 'firstName' | 'lastName' | 'username';
type CredentialsField = 'email' | 'phone' | 'password' | 'confirmPassword';

const REQUIRED = 'Ce champ est obligatoire.';
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .-]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s.()-]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

function nameProblem(value: string): string | undefined {
  const v = value.trim();
  if (!v) return REQUIRED;
  if (v.length > 50 || !NAME_PATTERN.test(v)) {
    return 'Lettres, espaces, apostrophes ou tirets uniquement.';
  }
  return undefined;
}

export function passwordProblem(password: string): string | undefined {
  if (!password) return REQUIRED;
  if (password.length < 8) return 'Au moins 8 caractères.';
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    return 'Au moins une lettre et un chiffre.';
  }
  return undefined;
}

export function validateIdentityStep(
  values: Pick<RegisterPayload, IdentityField>,
): FieldErrors<IdentityField> {
  const errors: FieldErrors<IdentityField> = {};
  const firstName = nameProblem(values.firstName);
  const lastName = nameProblem(values.lastName);
  if (firstName) errors.firstName = firstName;
  if (lastName) errors.lastName = lastName;
  const username = values.username.trim();
  if (!username) errors.username = REQUIRED;
  else if (!USERNAME_PATTERN.test(username)) {
    errors.username = '3 à 20 lettres, chiffres ou « _ ».';
  }
  return errors;
}

export function validateCredentialsStep(
  values: Pick<RegisterPayload, CredentialsField>,
): FieldErrors<CredentialsField> {
  const errors: FieldErrors<CredentialsField> = {};
  const email = values.email.trim();
  if (!email) errors.email = REQUIRED;
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'Adresse email invalide.';

  if (!values.phone.trim()) errors.phone = REQUIRED;
  else if (!PHONE_PATTERN.test(normalizePhone(values.phone))) {
    errors.phone = 'Format international attendu : + indicatif pays et numéro.';
  }

  const password = passwordProblem(values.password);
  if (password) errors.password = password;
  if (!values.confirmPassword) errors.confirmPassword = REQUIRED;
  else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = 'Les mots de passe ne correspondent pas.';
  }
  return errors;
}
