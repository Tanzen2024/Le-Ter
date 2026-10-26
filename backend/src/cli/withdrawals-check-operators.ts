import { connectDatabase, disconnectDatabase } from '../config/database';
import { loadEnvFile, readEnv } from '../config/env';
import {
  findOperatorMismatches,
  loadOpenWithdrawals,
} from '../services/withdrawals/withdrawal-operator-audit';

/**
 * `npm run withdrawals:check-operators` : outil d'EXPLOITATION, lecture seule, à lancer avant
 * d'activer les transferts. Liste les retraits non finaux dont l'opérateur enregistré (choisi
 * par le client avant D-163) diffère de celui déduit du numéro d'inscription. Aucune écriture,
 * aucun envoi, aucun numéro affiché. Code de sortie : 0 si aucun écart, 2 sinon.
 */
async function main(): Promise<void> {
  loadEnvFile();
  const env = readEnv();
  if (!env.databaseUrl) {
    console.error('DATABASE_URL absent : aucune base à vérifier.');
    process.exit(1);
  }
  const sql = await connectDatabase(env.databaseUrl);
  try {
    const open = await loadOpenWithdrawals(sql);
    const mismatches = findOperatorMismatches(open);
    console.log(JSON.stringify({ openWithdrawals: open.length, mismatches }, null, 2));
    console.log(
      mismatches.length === 0
        ? '\nAucun écart : les retraits ouverts utilisent l’opérateur de leur numéro.'
        : `\n${mismatches.length} retrait(s) à rapprocher AVANT d'activer les transferts.`,
    );
    process.exitCode = mismatches.length === 0 ? 0 : 2;
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  console.error('Échec :', err instanceof Error ? err.message : err);
  process.exit(1);
});
