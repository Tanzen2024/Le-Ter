import type { Logger } from '../../../utils/logger';

/**
 * Client HTTP de la NOUVELLE API CinetPay v1 (D-050). Contrats relevés dans le code source des
 * SDK officiels `cinetpay/cinetpay-js` et `cinetpay/cinetpay-go` (docs/payments.md §API) :
 *
 *   POST /v1/oauth/login   { api_key, api_password } → { code: 200, status: 'OK',
 *                          access_token, token_type: 'bearer', expires_in }
 *   POST /v1/payment       (Bearer) → { code: 200, status: 'OK', payment_token, notify_token,
 *                          transaction_id, merchant_transaction_id, payment_url, details }
 *   GET  /v1/payment/{id}  (Bearer) → { code, status, merchant_transaction_id,
 *                          transaction_id, user }
 *
 * Jeton expiré : code 1003 / statut EXPIRED_TOKEN → nouvelle authentification, une fois.
 *
 * Sécurité : la clé, le mot de passe, l'en-tête Authorization, le jeton d'accès et le
 * `notify_token` ne sont JAMAIS journalisés ni recopiés dans un message d'erreur. Seuls la
 * méthode, le chemin, le statut HTTP et le code/statut de l'API le sont.
 */
export const CINETPAY_SANDBOX_URL = 'https://api.cinetpay.net';
export const CINETPAY_PRODUCTION_URL = 'https://api.cinetpay.co';

/** Durée de cache par défaut du SDK officiel (23 h), plafond même si `expires_in` est plus long. */
export const CINETPAY_TOKEN_TTL_SECONDS = 82_800;
/** Marge : un jeton est renouvelé un peu avant son expiration annoncée. */
const TOKEN_EXPIRY_MARGIN_SECONDS = 300;
export const CINETPAY_DEFAULT_TIMEOUT_MS = 15_000;

const API_CODE_OK = 200;
const API_CODE_EXPIRED_TOKEN = 1003;

export type CinetPayErrorKind =
  | 'authentication'
  | 'expired_token'
  | 'http'
  | 'api'
  | 'timeout'
  | 'network'
  | 'malformed_response';

/** Erreur du fournisseur : jamais de secret dans le message (seulement codes et statuts). */
export class CinetPayError extends Error {
  constructor(
    readonly kind: CinetPayErrorKind,
    message: string,
    readonly details: { httpStatus?: number; apiCode?: number; apiStatus?: string } = {},
  ) {
    super(message);
    this.name = 'CinetPayError';
  }
}

export interface CinetPayClientOptions {
  baseUrl: string;
  apiKey: string;
  apiPassword: string;
  timeoutMs?: number;
  logger: Logger;
  /** Injection pour les tests ; `fetch` natif par défaut. */
  fetch?: typeof fetch;
  clock?: () => number;
}

/** Corps de POST /v1/payment (noms de champs du SDK officiel). */
export interface CinetPayPaymentRequest {
  merchantTransactionId: string;
  amount: number;
  currency: string;
  lang: 'fr' | 'en';
  designation: string;
  clientEmail: string;
  clientFirstName: string;
  clientLastName: string;
  successUrl: string;
  failedUrl: string;
  notifyUrl: string;
  channel: 'PUSH' | 'OTP' | 'QRCODE';
}

export interface CinetPayPaymentCreated {
  transactionId: string;
  merchantTransactionId: string;
  paymentUrl: string;
  /** Secret de notification : à hacher immédiatement, jamais stocké ni journalisé en clair. */
  notifyToken: string;
  /** `details.status` (INITIATED…), si présent. */
  initialStatus?: string;
}

export interface CinetPayPaymentStatus {
  code: number;
  /** SUCCESS, FAILED, INITIATED, PENDING, EXPIRED… (constantes du SDK). */
  status: string;
  transactionId: string;
  merchantTransactionId: string;
  /**
   * Absents du contrat documenté par les SDK : lus seulement si CinetPay les renvoie, pour
   * être comparés au paiement enregistré (jamais supposés présents).
   */
  amount?: number;
  currency?: string;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export class CinetPayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;
  // Champs privés JS : jamais énumérés (JSON.stringify, inspection, logs).
  readonly #apiKey: string;
  readonly #apiPassword: string;
  #token: { value: string; expiresAt: number } | undefined;
  #pendingAuth: Promise<string> | undefined;

  constructor(private readonly options: CinetPayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? CINETPAY_DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
    this.clock = options.clock ?? Date.now;
    this.#apiKey = options.apiKey;
    this.#apiPassword = options.apiPassword;
  }

  /** Jamais de secret dans une sérialisation accidentelle. */
  toJSON(): Json {
    return { baseUrl: this.baseUrl };
  }

  /**
   * Jeton d'accès, depuis le cache tant qu'il est valide ; sinon POST /v1/oauth/login.
   * Les authentifications simultanées sont regroupées en un seul appel.
   */
  async authenticate(): Promise<string> {
    if (this.#token && this.clock() < this.#token.expiresAt) {
      return this.#token.value;
    }
    this.#pendingAuth ??= this.login().finally(() => {
      this.#pendingAuth = undefined;
    });
    return this.#pendingAuth;
  }

  /** POST /v1/payment : initialise un paiement et renvoie l'URL de paiement. */
  async createPayment(request: CinetPayPaymentRequest): Promise<CinetPayPaymentCreated> {
    const body = {
      currency: request.currency,
      merchant_transaction_id: request.merchantTransactionId,
      amount: request.amount,
      lang: request.lang,
      designation: request.designation,
      client_email: request.clientEmail,
      client_first_name: request.clientFirstName,
      client_last_name: request.clientLastName,
      success_url: request.successUrl,
      failed_url: request.failedUrl,
      notify_url: request.notifyUrl,
      channel: request.channel,
    };
    const data = await this.withToken((token) =>
      this.request('POST', '/v1/payment', { body, token }),
    );
    if (data.code !== API_CODE_OK) {
      throw apiError('POST /v1/payment', data);
    }
    const details = isObject(data.details) ? data.details : undefined;
    if (
      !nonEmptyString(data.transaction_id) ||
      !nonEmptyString(data.notify_token) ||
      !nonEmptyString(data.payment_url) ||
      !isHttpsUrl(data.payment_url) ||
      data.merchant_transaction_id !== request.merchantTransactionId
    ) {
      throw new CinetPayError('malformed_response', 'Réponse CinetPay invalide (POST /v1/payment)');
    }
    return {
      transactionId: data.transaction_id,
      merchantTransactionId: data.merchant_transaction_id,
      paymentUrl: data.payment_url,
      notifyToken: data.notify_token,
      ...(details && nonEmptyString(details.status) && { initialStatus: details.status }),
    };
  }

  /**
   * GET /v1/payment/{identifier} : statut réel, de serveur à serveur. `identifier` accepte le
   * `transaction_id` CinetPay (utilisé ici), le `payment_token` ou le `merchant_transaction_id`.
   */
  async getPaymentStatus(identifier: string): Promise<CinetPayPaymentStatus> {
    const path = `/v1/payment/${encodeURIComponent(identifier)}`;
    const data = await this.withToken((token) => this.request('GET', path, { token }));
    if (
      typeof data.code !== 'number' ||
      !nonEmptyString(data.status) ||
      !nonEmptyString(data.transaction_id) ||
      !nonEmptyString(data.merchant_transaction_id)
    ) {
      // Ex. { code: 404, status: 'NOT_FOUND', description } : pas un statut de paiement.
      if (typeof data.code === 'number' && nonEmptyString(data.status)) {
        throw apiError('GET /v1/payment/{id}', data);
      }
      throw new CinetPayError('malformed_response', 'Réponse CinetPay invalide (GET /v1/payment)');
    }
    const amount = parseAmount(data.amount);
    return {
      code: data.code,
      status: data.status,
      transactionId: data.transaction_id,
      merchantTransactionId: data.merchant_transaction_id,
      ...(amount !== undefined && { amount }),
      ...(nonEmptyString(data.currency) && { currency: data.currency }),
    };
  }

  private async login(): Promise<string> {
    let data: Json;
    try {
      data = await this.request('POST', '/v1/oauth/login', {
        body: { api_key: this.#apiKey, api_password: this.#apiPassword },
      });
    } catch (err) {
      if (err instanceof CinetPayError && (err.kind === 'timeout' || err.kind === 'network')) {
        throw err;
      }
      const details = err instanceof CinetPayError ? err.details : {};
      throw new CinetPayError('authentication', 'Authentification CinetPay refusée', details);
    }
    if (data.code !== API_CODE_OK || !nonEmptyString(data.access_token)) {
      throw new CinetPayError('authentication', 'Authentification CinetPay refusée', {
        ...(typeof data.code === 'number' && { apiCode: data.code }),
        ...(typeof data.status === 'string' && { apiStatus: data.status }),
      });
    }
    const announced =
      typeof data.expires_in === 'number' && data.expires_in > 0
        ? data.expires_in
        : CINETPAY_TOKEN_TTL_SECONDS;
    const ttl = Math.max(
      Math.min(announced, CINETPAY_TOKEN_TTL_SECONDS) - TOKEN_EXPIRY_MARGIN_SECONDS,
      1,
    );
    this.#token = { value: data.access_token, expiresAt: this.clock() + ttl * 1000 };
    return data.access_token;
  }

  /** Exécute l'appel avec le jeton ; s'il a expiré côté CinetPay, ré-authentifie UNE fois. */
  private async withToken(call: (token: string) => Promise<Json>): Promise<Json> {
    const data = await call(await this.authenticate());
    if (!isExpiredToken(data)) return data;
    this.#token = undefined;
    const retried = await call(await this.authenticate());
    if (isExpiredToken(retried)) {
      throw new CinetPayError('expired_token', 'Jeton CinetPay refusé après renouvellement');
    }
    return retried;
  }

  /**
   * Requête JSON avec délai maximal (`AbortSignal.timeout`). Renvoie le corps JSON (objet) ;
   * un jeton expiré est renvoyé tel quel pour être renouvelé par `withToken`.
   */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    { body, token }: { body?: Json; token?: string },
  ): Promise<Json> {
    const log = this.options.logger;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        ...(body && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // `DOMException` (TimeoutError) n'est pas toujours `instanceof Error` (autre realm).
      const raw = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : '';
      const name = typeof raw === 'string' ? raw : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        log.warn('cinetpay request timeout', { method, path, timeoutMs: this.timeoutMs });
        throw new CinetPayError('timeout', `CinetPay n'a pas répondu à temps (${method} ${path})`);
      }
      log.warn('cinetpay network error', { method, path, errorName: name || typeof err });
      throw new CinetPayError('network', `CinetPay injoignable (${method} ${path})`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    const apiCode = isObject(data) && typeof data.code === 'number' ? data.code : undefined;
    const apiStatus = isObject(data) && typeof data.status === 'string' ? data.status : undefined;
    log.info('cinetpay response', {
      method,
      path,
      httpStatus: response.status,
      apiCode,
      apiStatus,
    });

    if (isObject(data) && isExpiredToken(data)) return data;
    if (!response.ok) {
      throw new CinetPayError('http', `CinetPay a répondu ${response.status} (${method} ${path})`, {
        httpStatus: response.status,
        ...(apiCode !== undefined && { apiCode }),
        ...(apiStatus !== undefined && { apiStatus }),
      });
    }
    if (!isObject(data)) {
      throw new CinetPayError(
        'malformed_response',
        `Réponse CinetPay illisible (${method} ${path})`,
      );
    }
    return data;
  }
}

function isExpiredToken(data: Json): boolean {
  return data.code === API_CODE_EXPIRED_TOKEN || data.status === 'EXPIRED_TOKEN';
}

function apiError(operation: string, data: Json): CinetPayError {
  return new CinetPayError('api', `CinetPay a refusé la requête (${operation})`, {
    ...(typeof data.code === 'number' && { apiCode: data.code }),
    ...(typeof data.status === 'string' && { apiStatus: data.status }),
  });
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Montant éventuellement renvoyé (nombre ou chaîne entière, comme les transferts du SDK). */
function parseAmount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) return Number(value);
  return undefined;
}
