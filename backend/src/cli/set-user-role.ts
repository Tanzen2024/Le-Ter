import { connectDatabase, disconnectDatabase } from '../config/database';
import { loadEnvFile, readEnv } from '../config/env';
import { isUserRole } from '../domain/users/user';
import { createLogger } from '../utils/logger';

/**
 * `npm run user:role -- <email> <user|admin>` : outil d'EXPLOITATION qui attribue un rôle à
 * un compte existant (D-049). C'est le SEUL moyen de devenir `admin` : aucune route HTTP ne
 * le permet. Le rôle est relu en base à chaque requête : il s'applique immédiatement.
 *
 * `admin` est le seul rôle d'administration (`SUPER_ADMIN` dans l'interface, D-061) ; à
 * réserver à un compte dédié : une connexion révoque la session précédente du compte (R-32).
 */
async function main(): Promise<void> {
  loadEnvFile();
  const env = readEnv();
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL non défini');
  }
  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3];
  if (!email || !isUserRole(role)) {
    throw new Error('Usage : npm run user:role -- <email> <user|admin>');
  }
  const logger = createLogger({ action: 'ADMIN_SET_USER_ROLE' });
  const sql = await connectDatabase(env.databaseUrl);
  try {
    const { rows } = await sql.query<{ id: string; role: string }>(
      `UPDATE users SET role = $2, updated_at = now() WHERE email = $1 RETURNING id, role`,
      [email, role],
    );
    const user = rows[0];
    if (!user) {
      throw new Error('Aucun compte avec cet email.');
    }
    // Ni l'email ni aucune donnée personnelle dans le journal : l'identifiant suffit.
    logger.info('user role set', { userId: user.id, role: user.role });
    console.log(`Compte ${user.id} : rôle ${user.role}`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  console.error('Échec :', err instanceof Error ? err.message : err);
  process.exit(1);
});
