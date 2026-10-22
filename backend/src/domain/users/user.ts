import { randomUUID } from 'node:crypto';

import type { PlayerId } from '../game/game-id';

/**
 * Identifiant d'un compte utilisateur : UUID v4 en minuscules, clé de `users`.
 *
 * Il n'existe aucune identité de joueur sans compte (R-10 : pas de mode invité).
 */
export type UserId = string & { readonly __brand: 'UserId' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUserId(value: unknown): value is UserId {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function newUserId(): UserId {
  return randomUUID() as UserId;
}

/**
 * Identité d'un utilisateur dans le domaine du jeu (D-029). `PlayerId` désigne le
 * compte qui participe à une partie : sa valeur EST l'identifiant du compte. Cette
 * fonction est le seul passage de l'un à l'autre, et elle n'est appelée qu'avec un
 * UserId issu du JWT vérifié, jamais avec une valeur envoyée par le client.
 */
export function playerIdOf(userId: UserId): PlayerId {
  return userId as string as PlayerId;
}

/**
 * Rôles des comptes. `admin` est le SEUL rôle d'administration, présenté comme
 * `SUPER_ADMIN` dans l'interface d'administration (D-061, R-09 tranché). Il n'est
 * attribuable que par l'outil `npm run user:role` (aucune route). Il ne se confond pas avec
 * le compte financier de la plateforme (`platform_ledger`, D-060), qui n'est pas un compte
 * utilisateur.
 */
export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return (USER_ROLES as readonly unknown[]).includes(value);
}
export type UserStatus = 'active' | 'disabled';

/** Compte complet, interne au serveur : `passwordHash` ne sort jamais de l'API. */
export interface User {
  id: UserId;
  /**
   * Numéro d'ordre du joueur sur la plateforme (D-133) : rang d'inscription, attribué par
   * PostgreSQL à la création du compte, unique et immuable.
   */
  playerNumber: number;
  firstName: string;
  lastName: string;
  /** Facultatif pour un joueur (D-135) : null, jamais une adresse inventée. Obligatoire pour un admin. */
  email: string | null;
  username: string;
  phone: string;
  phoneVerified: boolean;
  passwordHash: string;
  /** Un code de récupération actif existe (D-135) ; le code et son empreinte ne sortent jamais. */
  hasRecoveryCode: boolean;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Compte à créer : le numéro d'ordre est attribué par PostgreSQL à l'insertion ; l'empreinte
 * bcrypt du code de récupération (D-135) est écrite avec le compte.
 */
export type NewUser = Omit<User, 'playerNumber' | 'hasRecoveryCode'> & {
  recoveryCodeHash: string | null;
};

/** Ce que l'API renvoie d'un compte. */
export interface PublicUser {
  id: UserId;
  playerNumber: number;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string;
  phone: string;
  phoneVerified: boolean;
  hasRecoveryCode: boolean;
  role: UserRole;
  createdAt: string;
}

/** Liste blanche explicite : un nouveau champ de `User` n'est jamais exposé par accident. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    playerNumber: user.playerNumber,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    username: user.username,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    hasRecoveryCode: user.hasRecoveryCode,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
