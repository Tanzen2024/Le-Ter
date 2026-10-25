import { findPhoneCountry, splitInternationalNumber, toE164 } from '../../lib/phone-countries';
import type { ChangePasswordPayload, RegisterPayload } from '../../types/auth';

/**
 * Validation inline, miroir des règles du serveur (backend/src/validators/auth.validators.ts).
 * Elle ne sert qu'à l'affichage : le serveur reste la seule autorité.
 */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

type IdentityField = 'firstName' | 'lastName' | 'username';
type CredentialsField = 'email' | 'country' | 'phone' | 'password' | 'confirmPassword';

const REQUIRED = 'Ce champ est obligatoire.';
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .-]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

/**
 * Pays puis numéro NATIONAL (l'indicatif est un élément distinct, jamais saisi) : validé
 * selon les règles du pays choisi, les mêmes que celles du serveur, qui reconstruit lui-même
 * le numéro international.
 */
function phoneProblem(country: string, phone: string): string | undefined {
  // Sans pays, le téléphone est désactivé : seule l'erreur du pays est montrée.
  if (!country) return undefined;
  if (!phone.trim()) return REQUIRED;
  const known = findPhoneCountry(country);
  return known && toE164(known.code, phone) ? undefined : 'Numéro invalide pour ce pays.';
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

/** Code de parrainage (D-161), même normalisation que le serveur : majuscules, sans espace ni tiret. */
export function normalizeReferralInput(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

const REFERRAL_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

/** Facultatif : seule une forme impossible est refusée ici ; son existence est jugée par le serveur. */
export function referralCodeProblem(value: string): string | undefined {
  const code = normalizeReferralInput(value);
  if (!code) return undefined;
  return REFERRAL_PATTERN.test(code)
    ? undefined
    : 'Code de parrainage invalide : 8 lettres ou chiffres.';
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
  // Email facultatif (D-135) : vérifié seulement s'il est saisi.
  const email = values.email.trim();
  if (email && !EMAIL_PATTERN.test(email)) errors.email = 'Adresse email invalide.';

  if (!values.country) errors.country = REQUIRED;
  const phone = phoneProblem(values.country, values.phone);
  if (phone) errors.phone = phone;

  const password = passwordProblem(values.password);
  if (password) errors.password = password;
  if (!values.confirmPassword) errors.confirmPassword = REQUIRED;
  else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = 'Les mots de passe ne correspondent pas.';
  }
  return errors;
}

/** Pays + numéro national (connexion, récupération) : mêmes règles qu'à l'inscription. */
export function validatePhone(country: string, phone: string): FieldErrors<'country' | 'phone'> {
  const errors: FieldErrors<'country' | 'phone'> = {};
  if (!country) errors.country = REQUIRED;
  const problem = phoneProblem(country, phone);
  if (problem) errors.phone = problem;
  return errors;
}

/**
 * Champ unique de la connexion : une adresse e-mail dès qu'il contient « @ » ou une lettre,
 * sinon un numéro de téléphone. Le joueur ne choisit jamais le mode lui-même.
 */
export function looksLikeEmail(identifier: string): boolean {
  return /[@\p{L}]/u.test(identifier);
}

export type LoginCredentials = { email: string } | { country: string; phone: string };

/**
 * Identifiant de connexion → `{ email }` ou `{ country, phone }` (numéro national, sans
 * séparateurs), les deux formes acceptées par `POST /api/auth/login`. Un numéro tapé avec son
 * indicatif (« +237… ») l'emporte sur le pays sélectionné.
 */
export function resolveLoginIdentifier(
  country: string,
  identifier: string,
): { credentials: LoginCredentials } | { error: string } {
  const value = identifier.trim();
  if (!value) return { error: 'Saisissez votre téléphone ou votre adresse e-mail.' };
  if (looksLikeEmail(value)) {
    return EMAIL_PATTERN.test(value)
      ? { credentials: { email: value } }
      : { error: 'Adresse e-mail invalide.' };
  }
  if (/^(\+|00)/.test(value)) {
    const international = splitInternationalNumber(value);
    return international
      ? {
          credentials: {
            country: international.code,
            phone: international.national,
          },
        }
      : { error: 'Numéro de téléphone invalide.' };
  }
  const problem = country ? phoneProblem(country, value) : REQUIRED;
  return problem
    ? { error: problem }
    : { credentials: { country, phone: value.replace(/[\s.()-]/g, '') } };
}

/** Nouveau mot de passe et confirmation (réinitialisation, D-135). */
export function validateNewPassword(
  newPassword: string,
  confirmPassword: string,
): FieldErrors<'newPassword' | 'confirmPassword'> {
  const errors: FieldErrors<'newPassword' | 'confirmPassword'> = {};
  const password = passwordProblem(newPassword);
  if (password) errors.newPassword = password;
  if (!confirmPassword) errors.confirmPassword = REQUIRED;
  else if (confirmPassword !== newPassword) {
    errors.confirmPassword = 'Les mots de passe ne correspondent pas.';
  }
  return errors;
}

/** Changement de mot de passe (Profil) : mêmes règles que le serveur, affichage seulement. */
export function validatePasswordChange(
  values: ChangePasswordPayload,
): FieldErrors<keyof ChangePasswordPayload> {
  const errors: FieldErrors<keyof ChangePasswordPayload> = {};
  if (!values.currentPassword) errors.currentPassword = REQUIRED;
  const password = passwordProblem(values.newPassword);
  if (password) errors.newPassword = password;
  else if (values.newPassword === values.currentPassword) {
    errors.newPassword = 'Le nouveau mot de passe doit être différent de l’actuel.';
  }
  if (!values.confirmPassword) errors.confirmPassword = REQUIRED;
  else if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = 'Les mots de passe ne correspondent pas.';
  }
  return errors;
}
