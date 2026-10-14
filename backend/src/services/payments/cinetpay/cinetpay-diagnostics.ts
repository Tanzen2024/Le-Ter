import type { CinetPayEnv } from '../../../config/env';
import type { Logger } from '../../../utils/logger';
import { CinetPayClient, CinetPayError } from './cinetpay-client';

/**
 * Diagnostic d'exploitation de CinetPay (`npm run payments:diagnose`, docs/payments.md) : trois
 * niveaux DISTINCTS, du plus faible au plus fort.
 *
 * 1. `configured` : variables présentes et valides (validées par `readEnv`, rien de réseau) ;
 * 2. `reachability` : l'API répond en HTTP. Un 52x vient de Cloudflare (devant CinetPay) : son
 *    serveur d'origine ne répond pas, la panne est chez CinetPay ;
 * 3. `authentication` : POST /v1/oauth/login accepté (clé, mot de passe, IP autorisée).
 *
 * Aucun paiement n'est créé : qu'un paiement fonctionne réellement ne se prouve qu'en sandbox
 * (`payment: 'NOT_VERIFIED'`). Le jeton obtenu n'est jamais renvoyé ni journalisé.
 */
export interface CinetPayDiagnostic {
  configured: boolean;
  environment?: CinetPayEnv['environment'];
  baseUrl?: string;
  timeoutMs?: number;
  directPayMethods?: string[];
  pagePreselectMethods?: string[];
  reachability: ReachabilityResult;
  authentication: AuthenticationResult;
  payment: 'NOT_VERIFIED';
}

export type ReachabilityResult =
  | { status: 'SKIPPED' }
  | {
      status: 'REACHABLE' | 'ORIGIN_UNREACHABLE' | 'HTTP_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR';
      durationMs: number;
      httpStatus?: number;
    };

export type AuthenticationResult =
  | { status: 'SKIPPED'; reason: 'NOT_CONFIGURED' | 'UNREACHABLE' }
  | { status: 'ACCEPTED'; durationMs: number }
  | {
      status: 'REFUSED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'PROVIDER_ERROR';
      durationMs: number;
      httpStatus?: number;
      apiCode?: number;
      apiStatus?: string;
    };

/**
 * Délai de la sonde de joignabilité : supérieur à celui de Cloudflare (≈ 20 s avant un 522),
 * pour voir le 522 plutôt qu'un simple dépassement de délai.
 */
export const REACHABILITY_PROBE_TIMEOUT_MS = 30_000;

export interface CinetPayDiagnosticDeps {
  logger: Logger;
  fetch?: typeof fetch;
  clock?: () => number;
  probeTimeoutMs?: number;
}

/** Codes Cloudflare « origine injoignable » : 520 à 527 (530 : origine non résolue). */
const isCloudflareOriginError = (status: number) =>
  (status >= 520 && status <= 527) || status === 530;

export async function diagnoseCinetPay(
  env: CinetPayEnv | undefined,
  deps: CinetPayDiagnosticDeps,
): Promise<CinetPayDiagnostic> {
  if (!env) {
    return {
      configured: false,
      reachability: { status: 'SKIPPED' },
      authentication: { status: 'SKIPPED', reason: 'NOT_CONFIGURED' },
      payment: 'NOT_VERIFIED',
    };
  }
  const fetchImpl = deps.fetch ?? fetch;
  const clock = deps.clock ?? Date.now;
  const reachability = await probe(
    env.baseUrl,
    fetchImpl,
    clock,
    deps.probeTimeoutMs ?? REACHABILITY_PROBE_TIMEOUT_MS,
  );
  const authentication: AuthenticationResult =
    reachability.status === 'REACHABLE' || reachability.status === 'HTTP_ERROR'
      ? await authenticate(env, deps.logger, fetchImpl, clock)
      : { status: 'SKIPPED', reason: 'UNREACHABLE' };
  return {
    configured: true,
    environment: env.environment,
    baseUrl: env.baseUrl,
    timeoutMs: env.timeoutMs,
    directPayMethods: env.directPayMethods,
    pagePreselectMethods: env.pagePreselectMethods,
    reachability,
    authentication,
    payment: 'NOT_VERIFIED',
  };
}

async function probe(
  baseUrl: string,
  fetchImpl: typeof fetch,
  clock: () => number,
  timeoutMs: number,
): Promise<ReachabilityResult> {
  const started = clock();
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Corps ignoré : seule la réponse HTTP compte (n'importe quel code < 500 prouve que
    // l'API CinetPay elle-même répond).
    await res.body?.cancel().catch(() => undefined);
    const durationMs = clock() - started;
    const status = isCloudflareOriginError(res.status)
      ? 'ORIGIN_UNREACHABLE'
      : res.status >= 500
        ? 'HTTP_ERROR'
        : 'REACHABLE';
    return { status, durationMs, httpStatus: res.status };
  } catch (err) {
    const raw = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : '';
    const timedOut = raw === 'TimeoutError' || raw === 'AbortError';
    return { status: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', durationMs: clock() - started };
  }
}

async function authenticate(
  env: CinetPayEnv,
  logger: Logger,
  fetchImpl: typeof fetch,
  clock: () => number,
): Promise<AuthenticationResult> {
  const client = new CinetPayClient({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    apiPassword: env.apiPassword,
    timeoutMs: env.timeoutMs,
    logger,
    fetch: fetchImpl,
  });
  const started = clock();
  try {
    await client.authenticate();
    return { status: 'ACCEPTED', durationMs: clock() - started };
  } catch (err) {
    const durationMs = clock() - started;
    if (!(err instanceof CinetPayError)) return { status: 'PROVIDER_ERROR', durationMs };
    const status =
      err.kind === 'authentication'
        ? 'REFUSED'
        : err.kind === 'timeout'
          ? 'TIMEOUT'
          : err.kind === 'network'
            ? 'NETWORK_ERROR'
            : 'PROVIDER_ERROR';
    const { httpStatus, apiCode, apiStatus } = err.details;
    return {
      status,
      durationMs,
      ...(httpStatus !== undefined && { httpStatus }),
      ...(apiCode !== undefined && { apiCode }),
      ...(apiStatus && { apiStatus }),
    };
  }
}

/** Lecture humaine du diagnostic : cause probable et action, sans aucune valeur secrète. */
export function explainCinetPayDiagnostic(d: CinetPayDiagnostic): string {
  if (!d.configured) {
    return 'CinetPay non configuré (CINETPAY_API_KEY / CINETPAY_API_PASSWORD vides) : achats refusés (503 MOBILE_MONEY_UNAVAILABLE).';
  }
  const r = d.reachability;
  if (r.status === 'ORIGIN_UNREACHABLE') {
    return `Panne CHEZ CinetPay : Cloudflare répond ${r.httpStatus} (serveur d'origine de ${d.baseUrl} injoignable). Rien à corriger localement ; réessayer plus tard ou contacter CinetPay.`;
  }
  if (r.status === 'TIMEOUT' || r.status === 'NETWORK_ERROR') {
    return `${d.baseUrl} injoignable depuis ce serveur (${r.status}) : vérifier l'accès Internet sortant, le DNS et le proxy du poste.`;
  }
  const a = d.authentication;
  switch (a.status) {
    case 'ACCEPTED':
      return 'Configuration valide, API joignable, authentification acceptée. Un paiement réel ne se vérifie qu’en sandbox.';
    case 'REFUSED':
      return a.apiCode === 2011
        ? 'Authentification refusée (2011 NOT_ALLOWED) : l’adresse IP publique de ce serveur n’est pas autorisée sur le compte CinetPay (souvent après un changement de réseau).'
        : `Authentification refusée${a.apiCode !== undefined ? ` (code ${a.apiCode}${a.apiStatus ? ` ${a.apiStatus}` : ''})` : ''} : vérifier la clé et le mot de passe API.`;
    case 'TIMEOUT':
      return `API joignable mais l'authentification dépasse ${d.timeoutMs} ms (CINETPAY_TIMEOUT_MS) : CinetPay est lent ou dégradé.`;
    default:
      return `Erreur CinetPay pendant l'authentification (${a.status}${'httpStatus' in a && a.httpStatus ? ` HTTP ${a.httpStatus}` : ''}).`;
  }
}
