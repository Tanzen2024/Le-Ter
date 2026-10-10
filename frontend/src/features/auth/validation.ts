import { findPhoneCountry, toE164 } from '../../lib/phone-countries';
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
