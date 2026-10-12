/// <reference types="jest" />
import { API_URL, ApiError, apiRequest, REQUEST_TIMEOUT_MS, resolveApiUrl } from './api-client';

/**
 * Client HTTP : chaque échec garde sa vraie nature (serveur injoignable, délai dépassé,
 * refus HTTP), et le diagnostic de développement ne contient jamais de jeton.
 */

const fetchMock = jest.fn();
const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  warn.mockClear();
});
afterEach(() => jest.useRealTimers());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('la requête aurait dû échouer');
}

it('adresse de l’API : sans barre finale, le chemin s’ajoute tel quel', async () => {
  expect(API_URL).not.toMatch(/\/$/);
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  await apiRequest('/api/health');
  expect(fetchMock.mock.calls[0]![0]).toBe(`${API_URL}/api/health`);
});

it('serveur injoignable : NETWORK_ERROR (statut 0), destination journalisée sans jeton', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  const error = await failureOf(
    apiRequest('/api/games/me/active?x=secret', { accessToken: 'jeton-tres-secret' }),
  );

  expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  expect(error.message).toMatch(/Impossible de joindre le serveur/);
  expect(warn).toHaveBeenCalledWith('[réseau] NETWORK_ERROR', {
    method: 'GET',
    url: `${API_URL}/api/games/me/active`,
    cause: 'TypeError: Network request failed',
  });
  const logged = JSON.stringify(warn.mock.calls);
  expect(logged).not.toMatch(/jeton-tres-secret|Bearer|Authorization|secret/);
});

it('aucune réponse dans le délai : TIMEOUT (statut 0), requête abandonnée', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementationOnce(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal = init.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  );
  const pending = failureOf(apiRequest('/api/auth/login', { method: 'POST', body: {} }));
  jest.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1);
  expect(signal?.aborted).toBe(false);
  jest.advanceTimersByTime(1);

  const error = await pending;
  expect(signal?.aborted).toBe(true);
  expect(error).toMatchObject({ status: 0, code: 'TIMEOUT' });
  expect(error.message).toMatch(/ne répond pas/);
});

it('réponse rapide : le délai est annulé (aucun abandon tardif)', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
    signal = init.signal ?? undefined;
    return Promise.resolve(json(200, {}));
  });
  await apiRequest('/api/health');
  jest.advanceTimersByTime(REQUEST_TIMEOUT_MS * 2);
  expect(signal?.aborted).toBe(false);
});

it('401 : refus d’authentification, jamais présenté comme une erreur réseau', async () => {
  fetchMock.mockResolvedValueOnce(
    json(401, { code: 'AUTHENTICATION_REQUIRED', message: 'Authentification requise.' }),
  );
  const error = await failureOf(apiRequest('/api/auth/me', { accessToken: 't' }));

  expect(error).toMatchObject({ status: 401, code: 'AUTHENTICATION_REQUIRED' });
  expect(error.message).toBe('Authentification requise.');
  expect(warn).not.toHaveBeenCalled();
});

it('5xx sans corps JSON (proxy, panne) : erreur serveur dite comme telle et journalisée', async () => {
  fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
  const error = await failureOf(apiRequest('/api/wallet'));

  expect(error).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  expect(error.message).toMatch(/Le serveur a rencontré une erreur/);
  expect(warn).toHaveBeenCalledWith('[réseau] SERVER_ERROR', {
    method: 'GET',
    url: `${API_URL}/api/wallet`,
    status: 502,
    code: undefined,
  });
});

it('5xx avec message de l’API : le message du serveur est conservé', async () => {
  fetchMock.mockResolvedValueOnce(
    json(503, { code: 'ADMIN_UNAVAILABLE', message: 'Administration indisponible.' }),
  );
  const error = await failureOf(apiRequest('/api/admin/x'));
  expect(error).toMatchObject({ status: 503, code: 'ADMIN_UNAVAILABLE' });
  expect(error.message).toBe('Administration indisponible.');
});

it('204 : aucune donnée, aucune erreur', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(apiRequest('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
});

/**
 * URL de l'API : valeur explicite prioritaire ; `auto` ou absente → hôte du serveur Metro (le PC
 * qui sert aussi le backend), port 3000 : l'adresse suit le réseau du PC sans modification.
 */
describe('resolveApiUrl', () => {
  it('valeur explicite prioritaire (barre finale retirée)', () => {
    expect(resolveApiUrl('http://10.248.82.32:3000/', '192.168.1.5:8081')).toBe(
      'http://10.248.82.32:3000',
    );
  });

  it.each([undefined, '', '  ', 'auto', 'AUTO'])('%p → hôte de Metro, port 3000', (value) => {
    expect(resolveApiUrl(value, '10.248.82.32:8081')).toBe('http://10.248.82.32:3000');
  });

  it('ni valeur ni hôte Metro (production, tests) : localhost', () => {
    expect(resolveApiUrl(undefined, undefined)).toBe('http://localhost:3000');
    expect(resolveApiUrl('auto', undefined)).toBe('http://localhost:3000');
  });
});
