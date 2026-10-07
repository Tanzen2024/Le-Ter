import { createHash } from 'node:crypto';

import type { SqlExecutor } from '../../src/database/sql-client';
import type { PlayerId } from '../../src/domain/game/game-id';
import { playerIdOf, type UserId } from '../../src/domain/users/user';

/**
 * UUID d'utilisateur DÉTERMINISTE pour un nom de test ('alice' donne toujours le même
 * identifiant). Depuis la migration 0003, une partie stockée dans PostgreSQL ne peut
 * référencer que des comptes existants : voir `seedUsers`.
 */
export function testUserId(name: string): UserId {
  const hex = createHash('sha256').update(name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}` as UserId;
}

export function testPlayerId(name: string): PlayerId {
  return playerIdOf(testUserId(name));
}

/** Crée (si absents) les comptes de ces noms de test, avec un hash factice. */
export async function seedUsers(sql: SqlExecutor, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const id = testUserId(name);
    await sql.query(
      `INSERT INTO users (id, first_name, last_name, email, username, phone, password_hash,
         created_at, updated_at)
       VALUES ($1, $2, 'Test', $3, $4, $5, 'not-a-real-hash', now(), now())
       ON CONFLICT DO NOTHING`,
      [
        id,
        name,
        `${id}@test.local`,
        `u_${id.slice(0, 8)}`,
        `+1${parseInt(id.slice(0, 8), 16).toString().padStart(10, '0').slice(0, 10)}`,
      ],
    );
  }
}
