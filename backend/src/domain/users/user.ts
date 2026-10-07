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

/** Seul rôle défini aujourd'hui ; Admin et Katika attendent R-09. */
export type UserRole = 'user';
export type UserStatus = 'active' | 'disabled';

/** Compte complet, interne au serveur : `passwordHash` ne sort jamais de l'API. */
export interface User {
  id: UserId;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  phoneVerified: boolean;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Ce que l'API renvoie d'un compte. */
export interface PublicUser {
  id: UserId;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  phoneVerified: boolean;
  role: UserRole;
  createdAt: string;
}

/** Liste blanche explicite : un nouveau champ de `User` n'est jamais exposé par accident. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    username: user.username,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
