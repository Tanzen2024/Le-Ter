import type { Logger } from '../../../utils/logger';
import { MobileMoneyProviderError } from '../../wallet/mobile-money.gateway';

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
export class CinetPayError extends MobileMoneyProviderError {
  constructor(
    readonly kind: CinetPayErrorKind,
    message: string,
    readonly details: { httpStatus?: number; apiCode?: number; apiStatus?: string } = {},
  ) {
    super(message);
    this.name = 'CinetPayError';
  }
}

/**
 * Résultat d'un appel HTTP réel, pour la surveillance du fournisseur (D-100). Jamais de
 * secret, de jeton, de corps ni de donnée de payeur.
 */
export type CinetPayCallOutcome =
  | { type: 'auth_accepted' }
  | { type: 'auth_refused'; httpStatus?: number; apiCode?: number; ipNotAllowed: boolean }
  | { type: 'unreachable' }
  | { type: 'timeout' }
  | { type: 'server_error'; httpStatus: number }
  | { type: 'response' };

export interface CinetPayClientOptions {
  baseUrl: string;
  apiKey: string;
  apiPassword: string;
  timeoutMs?: number;
  logger: Logger;
  /** Injection pour les tests ; `fetch` natif par défaut. */
  fetch?: typeof fetch;
  clock?: () => number;
  /** Surveillance (D-100) : appelé après chaque appel ; une erreur du listener est ignorée. */
  onOutcome?: (outcome: CinetPayCallOutcome) => void;
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
  /**
   * Paiement DIRECT (sans redirection, SDK officiel) : `direct_pay: true`, `payment_method`,
   * `client_phone_number`. Jamais d'`otp_code` (collecte non autorisée). Le numéro n'est
   * jamais journalisé (le corps des requêtes ne l'est pas).
   */
  direct?: { paymentMethod: string; phoneNumber: string };
  /**
   * Numéro du payeur (`client_phone_number`, format `+237…`) pour TOUT paiement (D-088), page
   * hébergée comprise. En paiement direct, `direct.phoneNumber` (le même numéro) prévaut.
   */
  clientPhoneNumber?: string;
  /**
   * Page hébergée : opérateur présélectionné (`payment_method` seul, sans `direct_pay`). Absent :
   * toutes les méthodes du pays sont proposées (SDK officiels). Ignoré en paiement direct.
   */
  pagePaymentMethod?: string;
}

export interface CinetPayPaymentCreated {
  transactionId: string;
  merchantTransactionId: string;
  /** Page de paiement : toujours présente hors paiement direct, ou si une redirection est exigée. */
  paymentUrl?: string;
  /** Secret de notification : à hacher immédiatement, jamais stocké ni journalisé en clair. */
  notifyToken: string;
  /** `details.status` (INITIATED…), si présent. Jamais une preuve de paiement. */
  initialStatus?: string;
  /**
   * `details.must_be_redirected` : vrai si le joueur doit ouvrir `paymentUrl` (paiement
   * classique, ou paiement direct que CinetPay n'a pas pu lancer sur le téléphone).
   */
  mustBeRedirected: boolean;
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

/** Corps de POST /v1/transfer (noms de champs du SDK officiel, `serializeTransferRequest`). */
export interface CinetPayTransferRequest {
  merchantTransactionId: string;
  /** Numéro du bénéficiaire, format international (`+237…`). Jamais journalisé. */
  phoneNumber: string;
  amount: number;
  currency: string;
  /** Opérateur (`OM_CM`, `MTN_CM`…). */
  paymentMethod: string;
  reason: string;
  notifyUrl: string;
}

/** Réponse d'un transfert créé : statut INITIAL (PENDING, SUCCESS…), jamais une preuve. */
export interface CinetPayTransferCreated {
  code: number;
  status: string;
  transactionId: string;
  merchantTransactionId: string;
  /** Secret de notification : à hacher immédiatement, jamais stocké ni journalisé en clair. */
  notifyToken?: string;
  feeAmount?: number;
}

/** GET /v1/transfer/{id} : statut réel d'un transfert, ou absence du transfert chez CinetPay. */
export type CinetPayTransferLookup =
  | {
      found: true;
      code: number;
      status: string;
      transactionId: string;
      merchantTransactionId: string;
      amount?: number;
      feeAmount?: number;
      currency?: string;
    }
  | { found: false };

/** GET /v1/balances : solde disponible pour les transferts, tel que renvoyé (non interprété). */
export interface CinetPayBalance {
  code: number;
  status: string;
  availableBalance: string;
  currency?: string;
}

/** Codes API d'une demande de transfert REFUSÉE (rien n'a été créé chez CinetPay). */
export const CINETPAY_TRANSFER_REJECTION_CODES: ReadonlySet<number> = new Set([
  1002, // INVALID_TOKEN
  1004, // INVALID_PARAMS
  1005, // INVALID_CREDENTIALS
  2005, // INSUFFICIENT_BALANCE (solde marchand)
  2006, // USER_NOT_FOUND
  2007, // USER_IS_BLOCKED
  2010, // FAILED
  2011, // NOT_ALLOWED (IP non autorisée)
]);
/**
 * Échec survenu AVANT l'envoi de `POST /v1/transfer` (authentification refusée ou
 * injoignable) : aucune demande de transfert n'a quitté le serveur. Fait local certain, à la
 * différence d'un refus annoncé par CinetPay.
 */
export class CinetPayTransferNotSentError extends Error {
  constructor(override readonly cause: unknown) {
    super("Demande de transfert non envoyée à CinetPay");
    this.name = 'CinetPayTransferNotSentError';
  }
}

/**
 * Création de paiement JAMAIS envoyée (authentification refusée, CinetPay injoignable avant
 * l'envoi) : aucune demande n'a quitté le serveur, le paiement n'existe pas chez CinetPay.
 */
export class CinetPayPaymentNotSentError extends MobileMoneyProviderError {
  constructor(override readonly cause: unknown) {
    super('Demande de paiement non envoyée à CinetPay');
    this.name = 'CinetPayPaymentNotSentError';
  }
}

/** Référence marchande déjà utilisée : le transfert existe, il faut le relire. */
export const CINETPAY_TRANSACTION_EXIST = 1200;
const API_CODE_NOT_FOUND = 404;

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
      ...((request.direct?.phoneNumber ?? request.clientPhoneNumber) && {
        client_phone_number: request.direct?.phoneNumber ?? request.clientPhoneNumber,
      }),
      ...(request.direct
        ? { payment_method: request.direct.paymentMethod, direct_pay: true }
        : request.pagePaymentMethod && { payment_method: request.pagePaymentMethod }),
    };
    // Vrai dès que POST /v1/payment est émis : au-delà, l'issue n'est plus connue localement.
    let sent = false;
    let data: Json;
    try {
      data = await this.withToken((token) => {
        sent = true;
        return this.request('POST', '/v1/payment', { body, token });
      });
    } catch (err) {
      if (!sent) throw new CinetPayPaymentNotSentError(err);
      throw err;
    }
    if (data.code !== API_CODE_OK) {
      throw apiError('POST /v1/payment', data);
    }
    const details = isObject(data.details) ? data.details : undefined;
    // Paiement classique : redirection toujours. Direct : seulement si CinetPay l'exige.
    const mustBeRedirected = !request.direct || details?.must_be_redirected === true;
    const paymentUrl = nonEmptyString(data.payment_url) ? data.payment_url : undefined;
    if (
      !nonEmptyString(data.transaction_id) ||
      !nonEmptyString(data.notify_token) ||
      (paymentUrl !== undefined && !isHttpsUrl(paymentUrl)) ||
      (mustBeRedirected && paymentUrl === undefined) ||
      data.merchant_transaction_id !== request.merchantTransactionId
    ) {
      throw new CinetPayError('malformed_response', 'Réponse CinetPay invalide (POST /v1/payment)');
    }
    return {
      transactionId: data.transaction_id,
      merchantTransactionId: data.merchant_transaction_id,
      ...(paymentUrl && { paymentUrl }),
      notifyToken: data.notify_token,
      ...(details && nonEmptyString(details.status) && { initialStatus: details.status }),
      mustBeRedirected,
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

  /**
   * POST /v1/transfer : transfert SORTANT vers un numéro Mobile Money (API de transfert, pas
   * la collecte). La réponse porte le statut initial du transfert (PENDING le plus souvent,
   * `code` 2002) : ce n'est jamais une preuve de réussite.
   *
   * Erreurs : `CinetPayError` (refus avec `apiCode`, ou incertitude : délai, réseau, réponse
   * illisible). Le numéro n'apparaît dans aucun journal ni message d'erreur.
   */
  async createTransfer(request: CinetPayTransferRequest): Promise<CinetPayTransferCreated> {
    const body = {
      currency: request.currency,
      merchant_transaction_id: request.merchantTransactionId,
      phone_number: request.phoneNumber,
      amount: request.amount,
      payment_method: request.paymentMethod,
      reason: request.reason,
      notify_url: request.notifyUrl,
    };
    // Vrai dès que POST /v1/transfer est émis : au-delà, l'issue n'est plus connue localement.
    let sent = false;
    let data: Json;
    try {
      data = await this.withToken((token) => {
        sent = true;
        return this.request('POST', '/v1/transfer', { body, token });
      });
    } catch (err) {
      if (!sent) throw new CinetPayTransferNotSentError(err);
      throw err;
    }
    if (typeof data.code !== 'number' || !nonEmptyString(data.status)) {
      throw new CinetPayError('malformed_response', 'Réponse CinetPay invalide (POST /v1/transfer)');
    }
    if (!nonEmptyString(data.transaction_id)) {
      // Ex. { code: 1200, status: 'TRANSACTION_EXIST' } : aucun transfert décrit.
      throw apiError('POST /v1/transfer', data);
    }
    if (data.merchant_transaction_id !== request.merchantTransactionId) {
      throw new CinetPayError('malformed_response', 'Réponse CinetPay invalide (POST /v1/transfer)');
    }
    const feeAmount = parseAmount(data.fee_amount);
    return {
      code: data.code,
      status: data.status,
      transactionId: data.transaction_id,
      merchantTransactionId: data.merchant_transaction_id,
      ...(nonEmptyString(data.notify_token) && { notifyToken: data.notify_token }),
      ...(feeAmount !== undefined && { feeAmount }),
    };
  }

  /**
   * GET /v1/transfer/{identifier} : statut réel d'un transfert, de serveur à serveur.
   * `identifier` : `transaction_id` CinetPay OU notre `merchant_transaction_id` (SDK), ce qui
   * permet de relire un transfert dont la réponse de création a été perdue. Un transfert
   * inconnu de CinetPay renvoie `{ found: false }`.
   */
  async getTransferStatus(identifier: string): Promise<CinetPayTransferLookup> {
    const path = `/v1/transfer/${encodeURIComponent(identifier)}`;
    let data: Json;
    try {
      data = await this.withToken((token) => this.request('GET', path, { token }));
    } catch (err) {
      if (err instanceof CinetPayError && isNotFound(err.details)) return { found: false };
      throw err;
    }
    if (isNotFound({ apiCode: data.code, apiStatus: data.status })) return { found: false };
    if (
      typeof data.code !== 'number' ||
      !nonEmptyString(data.status) ||
      !nonEmptyString(data.transaction_id) ||
      !nonEmptyString(data.merchant_transaction_id)
    ) {
      if (typeof data.code === 'number' && nonEmptyString(data.status)) {
        throw apiError('GET /v1/transfer/{id}', data);
      }
      throw new CinetPayError('malformed_response', 'Réponse CinetPay invalide (GET /v1/transfer)');
    }
    const amount = parseAmount(data.amount);
    const feeAmount = parseAmount(data.fee_amount);
    return {
      found: true,
      code: data.code,
      status: data.status,
      transactionId: data.transaction_id,
      merchantTransactionId: data.merchant_transaction_id,
      ...(amount !== undefined && { amount }),
      ...(feeAmount !== undefined && { feeAmount }),
      ...(nonEmptyString(data.currency) && { currency: data.currency }),
    };
  }

  /**
   * GET /v1/balances (Bearer) : solde du compte marchand DISPONIBLE pour les transferts (SDK
   * officiel `cinetpay-js`, `src/api/balance.ts` et `src/types/balance.ts` :
   * `{ code, status, available_balance (chaîne), currency }`). Lecture seule : n'initie aucun
   * mouvement. Le montant est renvoyé tel quel (chaîne) ; son interprétation revient à
   * l'appelant (D-078), qui refuse tout montant non entier ou d'une autre devise.
   */
  async getBalance(): Promise<CinetPayBalance> {
    const data = await this.withToken((token) => this.request('GET', '/v1/balances', { token }));
    const raw = data.available_balance;
    // Le code de succès n'est pas documenté par le SDK : seule la présence des champs compte.
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      if (typeof data.code === 'number' || typeof data.status === 'string') {
        throw apiError('GET /v1/balances', data);
      }
      throw new CinetPayError('malformed_response', 'Réponse CinetPay invalide (GET /v1/balances)');
    }
    return {
      code: typeof data.code === 'number' ? data.code : 0,
      status: typeof data.status === 'string' ? data.status : '',
      availableBalance: String(raw),
      ...(typeof data.currency === 'string' && { currency: data.currency }),
    };
  }

  private emit(outcome: CinetPayCallOutcome): void {
    try {
      this.options.onOutcome?.(outcome);
    } catch {
      // La surveillance ne doit jamais faire échouer un paiement.
    }
  }

  private async login(): Promise<string> {
    let data: Json;
    try {
      data = await this.request('POST', '/v1/oauth/login', {
        body: { api_key: this.#apiKey, api_password: this.#apiPassword },
      });
    } catch (err) {
      // Panne du fournisseur (délai, réseau, 5xx dont les 52x de Cloudflare) : jamais présentée
      // comme un refus d'authentification (clé ou IP), qui orienterait vers une fausse cause.
      if (
        err instanceof CinetPayError &&
        (err.kind === 'timeout' ||
          err.kind === 'network' ||
          (err.kind === 'http' && (err.details.httpStatus ?? 0) >= 500))
      ) {
        throw err;
      }
      const details = err instanceof CinetPayError ? err.details : {};
      this.emitAuthRefused(details);
      throw new CinetPayError('authentication', 'Authentification CinetPay refusée', details);
    }
    if (data.code !== API_CODE_OK || !nonEmptyString(data.access_token)) {
      const details = {
        ...(typeof data.code === 'number' && { apiCode: data.code }),
        ...(typeof data.status === 'string' && { apiStatus: data.status }),
      };
      this.emitAuthRefused(details);
      throw new CinetPayError('authentication', 'Authentification CinetPay refusée', details);
    }
    this.emit({ type: 'auth_accepted' });
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

  private emitAuthRefused(details: { httpStatus?: number; apiCode?: number; apiStatus?: string }) {
    this.emit({
      type: 'auth_refused',
      ...(details.httpStatus !== undefined && { httpStatus: details.httpStatus }),
      ...(details.apiCode !== undefined && { apiCode: details.apiCode }),
      // Code 2011 NOT_ALLOWED : « This Ip is not withlisted » (adresse IP du serveur).
      ipNotAllowed: details.apiCode === 2011 || details.apiStatus === 'NOT_ALLOWED',
    });
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
        this.emit({ type: 'timeout' });
        throw new CinetPayError('timeout', `CinetPay n'a pas répondu à temps (${method} ${path})`);
      }
      // Cause système (DNS : ENOTFOUND / EAI_AGAIN, ECONNREFUSED…) : seul son code est noté.
      const cause =
        typeof err === 'object' && err !== null
          ? (err as { cause?: { code?: unknown } }).cause?.code
          : undefined;
      log.warn('cinetpay network error', {
        method,
        path,
        errorName: name || typeof err,
        ...(typeof cause === 'string' && { cause }),
      });
      this.emit({ type: 'unreachable' });
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

    if (response.status >= 500) this.emit({ type: 'server_error', httpStatus: response.status });
    else if (response.ok && path !== '/v1/oauth/login' && !(isObject(data) && isExpiredToken(data))) {
      this.emit({ type: 'response' });
    }
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

/** NOT_FOUND (code 404) : la ressource n'existe pas chez CinetPay. */
function isNotFound(details: { apiCode?: unknown; apiStatus?: unknown }): boolean {
  return details.apiCode === API_CODE_NOT_FOUND || details.apiStatus === 'NOT_FOUND';
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
