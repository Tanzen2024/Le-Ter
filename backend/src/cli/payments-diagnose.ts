import { loadEnvFile, readEnv } from '../config/env';
import {
  diagnoseCinetPay,
  explainCinetPayDiagnostic,
} from '../services/payments/cinetpay/cinetpay-diagnostics';
import { createLogger } from '../utils/logger';

/**
 * `npm run payments:diagnose` : outil d'EXPLOITATION, lecture seule. Lit la configuration du
 * backend (`backend/.env`) et indique si CinetPay est configuré, joignable et s'il accepte
 * l'authentification. Aucun paiement créé, aucune écriture en base, aucun secret affiché.
 * Code de sortie : 0 si l'authentification est acceptée, 2 sinon.
 */
async function main(): Promise<void> {
  loadEnvFile();
  const env = readEnv();
  // Journal du client limité aux avertissements : le rapport suffit.
  const logger = createLogger({ action: 'PAYMENTS_DIAGNOSE' }, (line, level) => {
    if (level === 'warn' || level === 'error') console.error(line);
  });
  const report = await diagnoseCinetPay(env.cinetpay, { logger });
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n${explainCinetPayDiagnostic(report)}`);
  process.exit(report.authentication.status === 'ACCEPTED' ? 0 : 2);
}

main().catch((err: unknown) => {
  console.error('Échec :', err instanceof Error ? err.message : err);
  process.exit(1);
});
