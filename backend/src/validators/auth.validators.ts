import { getCountries, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

import { BCRYPT_MAX_PASSWORD_BYTES } from '../services/auth/password.service';
import { ValidationError } from './validation-error';

/**
 * Validation et normalisation des entrées d'authentification (D-029). Le serveur
 * est la seule autorité : le frontend reproduit ces règles pour l'affichage seulement.
 *
 * Seuls les champs attendus sont lus : un `id`, `userId`, `role` ou `phoneVerified`
 * envoyé par le client est ignoré.
 */
export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .-]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
/** Pays acceptés à l'inscription : ceux dont les règles de numérotation sont connues. */
const SUPPORTED_COUNTRIES: ReadonlySet<string> = new Set(getCountries());
const MAX_NAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
/** Borne de la connexion : évite de faire hacher un corps énorme. */
const MAX_LOGIN_PASSWORD_LENGTH = 1024;

const REQUIRED = 'Ce champ est obligatoire.';

export function parseRegisterInput(body: unknown): RegisterInput {
  const source = asRecord(body);
  const fields: Record<string, string> = {};

  const firstName = name(source.firstName, 'firstName', fields);
  const lastName = name(source.lastName, 'lastName', fields);
  const email = parseEmail(source.email, fields);

  const rawUsername = text(source.username);
  if (!rawUsername) {
    fields.username = REQUIRED;
  } else if (!USERNAME_PATTERN.test(rawUsername)) {
    fields.username = 'Le pseudo doit contenir 3 à 20 lettres, chiffres ou « _ ».';
  }

  const phone = parsePhone(source.country, source.phone, fields);

  const password = typeof source.password === 'string' ? source.password : '';
  const passwordProblem = checkPasswordStrength(password);
  if (passwordProblem) {
    fields.password = passwordProblem;
  }
  if (typeof source.confirmPassword !== 'string' || source.confirmPassword === '') {
    fields.confirmPassword = REQUIRED;
  } else if (source.confirmPassword !== password) {
    fields.confirmPassword = 'Les mots de passe ne correspondent pas.';
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields);
  }
  // confirmPassword n'est utilisé que pour la comparaison : il n'est pas renvoyé.
  return { firstName, lastName, email, username: rawUsername, phone, password };
}

export function parseLoginInput(body: unknown): LoginInput {
  const source = asRecord(body);
  const fields: Record<string, string> = {};
  const email = text(source.email).toLowerCase();
  if (!email) {
    fields.email = REQUIRED;
  }
  const password = typeof source.password === 'string' ? source.password : '';
  if (!password) {
    fields.password = REQUIRED;
  } else if (password.length > MAX_LOGIN_PASSWORD_LENGTH) {
    fields.password = 'Mot de passe trop long.';
  }
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields);
  }
  return { email, password };
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Corps de POST /api/auth/password : mot de passe actuel, nouveau (même politique qu'à
 * l'inscription), confirmation identique, nouveau différent de l'actuel. Aucun identifiant
 * d'utilisateur n'est lu : le compte est celui du JWT.
 */
export function parseChangePasswordInput(body: unknown): ChangePasswordInput {
  const source = asRecord(body);
  const fields: Record<string, string> = {};
  const currentPassword = typeof source.currentPassword === 'string' ? source.currentPassword : '';
  if (!currentPassword) {
    fields.currentPassword = REQUIRED;
  } else if (currentPassword.length > MAX_LOGIN_PASSWORD_LENGTH) {
    fields.currentPassword = 'Mot de passe trop long.';
  }
  const newPassword = typeof source.newPassword === 'string' ? source.newPassword : '';
  const strength = checkPasswordStrength(newPassword);
  if (strength) {
    fields.newPassword = strength;
  } else if (newPassword === currentPassword) {
    fields.newPassword = 'Le nouveau mot de passe doit être différent de l’actuel.';
  }
  if (typeof source.confirmPassword !== 'string' || source.confirmPassword === '') {
    fields.confirmPassword = REQUIRED;
  } else if (source.confirmPassword !== newPassword) {
    fields.confirmPassword = 'Les mots de passe ne correspondent pas.';
  }
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields);
  }
  return { currentPassword, newPassword };
}

/** Corps `{ refreshToken }` de /refresh et /logout. Le format est vérifié par le service. */
export function parseRefreshTokenInput(body: unknown): string {
  const { refreshToken } = asRecord(body);
  if (typeof refreshToken !== 'string' || refreshToken === '') {
    throw new ValidationError({ refreshToken: REQUIRED });
  }
  return refreshToken;
}

/** Problème de robustesse du mot de passe, ou undefined s'il est acceptable. */
export function checkPasswordStrength(password: string): string | undefined {
  if (!password) {
    return REQUIRED;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_PASSWORD_BYTES) {
    return 'Le mot de passe est trop long (72 octets maximum).';
  }
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return undefined;
}

/**
 * Pays (ISO 3166-1 alpha-2) et numéro NATIONAL → numéro E.164 reconstruit par le serveur,
 * seul format stocké. Le numéro est validé selon les règles du pays choisi (métadonnées
 * libphonenumber) : un indicatif fourni par le client n'est accepté que s'il est celui de ce
 * pays (`+33…` avec `CM` est refusé).
 */
function parsePhone(rawCountry: unknown, rawPhone: unknown, fields: Record<string, string>) {
  const country = text(rawCountry).toUpperCase();
  const input = text(rawPhone);
  if (!country) {
    fields.country = REQUIRED;
  } else if (!SUPPORTED_COUNTRIES.has(country)) {
    fields.country = 'Pays non pris en charge.';
  }
  if (!input) {
    fields.phone = REQUIRED;
    return '';
  }
  if (fields.country) return '';
  const parsed = parsePhoneNumberFromString(normalizePhone(input), country as CountryCode);
  if (!parsed || !parsed.isValid() || parsed.country !== country) {
    fields.phone = 'Numéro invalide pour le pays sélectionné.';
    return '';
  }
  return parsed.number;
}

/** Retire espaces, points, tirets et parenthèses ; « 00 » initial devient « + ». */
export function normalizePhone(value: string): string {
  const compact = value.replace(/[\s.()-]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

function parseEmail(value: unknown, fields: Record<string, string>): string {
  const email = text(value).toLowerCase();
  if (!email) {
    fields.email = REQUIRED;
  } else if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    fields.email = 'Adresse email invalide.';
  }
  return email;
}

function name(value: unknown, field: string, fields: Record<string, string>): string {
  const normalized = text(value).replace(/\s+/g, ' ');
  if (!normalized) {
    fields[field] = REQUIRED;
  } else if (normalized.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(normalized)) {
    fields[field] =
      `Lettres, espaces, apostrophes ou tirets uniquement (${MAX_NAME_LENGTH} maximum).`;
  }
  return normalized;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}
