// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { ServerConfig } from '@/lib/server/config';
import { readServerConfig } from '@/lib/server/config';
import { checkCsrf } from '@/lib/server/csrf';
import {
  adminPath,
  forwardAdminRequest,
  loginAdmin,
  logoutAdmin,
  type GatewayRequest,
} from '@/lib/server/gateway';
import { COOKIE_NAMES } from '@/lib/server/session-cookies';

const config: ServerConfig = {
  apiUrl: 'http://backend.test',
  publicOrigin: 'https://admin.test',
  secureCookies: true,
};

function request(
  overrides: Omit<Partial<GatewayRequest>, 'headers'> & { headers?: Record<string, string> } = {},
): GatewayRequest {
  return {
    method: 'GET',
    url: 'https://admin.test/api/admin/dashboard?from=a',
    body: null,
    cookies: { access: 'access-1', refresh: 'refresh-1', csrf: 'csrf-token-123' },
    ...overrides,
    headers: new Headers(overrides.headers ?? {}),
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const text = (body: string | ArrayBuffer | null) =>
  typeof body === 'string' ? body : body ? new TextDecoder().decode(body) : '';

describe('relais /api/admin/* (passerelle serveur)', () => {
  it('ajoute le jeton du cookie httpOnly et relaie la réponse du backend', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { ok: true }));
    const res = await forwardAdminRequest(['dashboard'], request(), config, fetchImpl);
    expect(res.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://backend.test/api/admin/dashboard?from=a');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer access-1' });
    expect(res.cookies).toEqual([]);
  });

  it('refuse les chemins dangereux et les routes de session réservées', () => {
    expect(adminPath(['..', 'auth'])).toBeNull();
    expect(adminPath(['users', 'a/b'])).toBeNull();
    expect(adminPath(['auth', 'login'])).toBeNull();
    expect(adminPath(['auth', 'logout'])).toBeNull();
    expect(adminPath(['users', 'abc'])).toBe('/api/admin/users/abc');
  });

  it('modification sans Origin, d’une autre origine ou sans jeton CSRF : 403, rien n’est envoyé', async () => {
    const fetchImpl = vi.fn();
    const cases = [
      request({ method: 'POST', headers: {} }),
      request({
        method: 'POST',
        headers: { origin: 'https://evil.test', 'x-csrf-token': 'csrf-token-123' },
      }),
      request({ method: 'POST', headers: { origin: 'https://admin.test' } }),
      request({
        method: 'POST',
        headers: { origin: 'https://admin.test', 'x-csrf-token': 'csrf-token-XXX' },
      }),
    ];
    for (const req of cases) {
      const res = await forwardAdminRequest(['payments', 'p', 'verify'], req, config, fetchImpl);
      expect(res.status).toBe(403);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('modification de même origine avec le bon jeton : relayée avec Idempotency-Key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { outcome: 'pending' }));
    const res = await forwardAdminRequest(
      ['payments', 'p1', 'verify'],
      request({
        method: 'POST',
        body: '{}',
        headers: {
          origin: 'https://admin.test',
          'x-csrf-token': 'csrf-token-123',
          'content-type': 'application/json',
          'idempotency-key': 'verify-12345678',
        },
      }),
      config,
      fetchImpl,
    );
    expect(res.status).toBe(200);
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      'idempotency-key': 'verify-12345678',
    });
  });

  it('sans cookie de session : 401 sans appel au backend', async () => {
    const fetchImpl = vi.fn();
    const res = await forwardAdminRequest(
      ['dashboard'],
      request({ cookies: {} }),
      config,
      fetchImpl,
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('access token expiré : un renouvellement, une nouvelle tentative, nouveaux cookies', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const res = await forwardAdminRequest(['dashboard'], request(), config, fetchImpl);
    expect(res.status).toBe(200);
    expect(fetchImpl.mock.calls[1]![0]).toBe('http://backend.test/api/auth/refresh');
    expect((fetchImpl.mock.calls[2]![1] as RequestInit).headers).toMatchObject({
      authorization: 'Bearer access-2',
    });
    const set = Object.fromEntries(res.cookies.map((c) => [c.name, c]));
    expect(set[COOKIE_NAMES.access]?.value).toBe('access-2');
    expect(set[COOKIE_NAMES.refresh]?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });
  });

  it('session d’administration expirée côté serveur : cookies effacés, code transmis', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json(401, { code: 'ADMIN_SESSION_EXPIRED', message: 'expirée' }));
    const res = await forwardAdminRequest(['dashboard'], request(), config, fetchImpl);
    expect(res.status).toBe(401);
    expect(JSON.parse(text(res.body)).code).toBe('ADMIN_SESSION_EXPIRED');
    expect(res.cookies.every((c) => c.options.maxAge === 0)).toBe(true);
  });

  it('renouvellement refusé (session close) : 401 ADMIN_SESSION_EXPIRED et cookies effacés', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }))
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }));
    const res = await forwardAdminRequest(['dashboard'], request(), config, fetchImpl);
    expect(res.status).toBe(401);
    expect(res.cookies.every((c) => c.options.maxAge === 0)).toBe(true);
  });

  it('backend injoignable : 502 lisible', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await forwardAdminRequest(['dashboard'], request(), config, fetchImpl);
    expect(res.status).toBe(502);
    expect(JSON.parse(text(res.body)).code).toBe('BACKEND_UNAVAILABLE');
  });
});

describe('connexion et déconnexion', () => {
  it('connexion : jetons gardés en cookies httpOnly, jamais renvoyés au navigateur', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(200, {
        accessToken: 'a',
        refreshToken: 'r',
        user: { id: 'u' },
        displayRole: 'SUPER_ADMIN',
        session: {},
      }),
    );
    const res = await loginAdmin(
      request({
        method: 'POST',
        body: '{"email":"x","password":"y"}',
        cookies: {},
        headers: { origin: 'https://admin.test' },
      }),
      config,
      fetchImpl,
    );
    expect(res.status).toBe(200);
    expect(text(res.body)).not.toMatch(/accessToken|refreshToken/);
    const names = res.cookies.map((c) => c.name).sort();
    expect(names).toEqual([COOKIE_NAMES.access, COOKIE_NAMES.csrf, COOKIE_NAMES.refresh].sort());
    expect(res.cookies.find((c) => c.name === COOKIE_NAMES.csrf)?.options.httpOnly).toBe(false);
    expect(
      res.cookies.filter((c) => c.name !== COOKIE_NAMES.csrf).every((c) => c.options.httpOnly),
    ).toBe(true);
  });

  it('connexion depuis une autre origine (login CSRF) : 403', async () => {
    const fetchImpl = vi.fn();
    const res = await loginAdmin(
      request({
        method: 'POST',
        body: '{}',
        cookies: {},
        headers: { origin: 'https://evil.test' },
      }),
      config,
      fetchImpl,
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('identifiants refusés : statut du backend relayé, aucun cookie', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, { code: 'INVALID_CREDENTIALS' }));
    const res = await loginAdmin(
      request({
        method: 'POST',
        body: '{}',
        cookies: {},
        headers: { origin: 'https://admin.test' },
      }),
      config,
      fetchImpl,
    );
    expect(res.status).toBe(401);
    expect(res.cookies).toEqual([]);
  });

  it('déconnexion : session terminée côté serveur (après renouvellement si besoin), cookies effacés', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'a2', refreshToken: 'r2' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await logoutAdmin(
      request({
        method: 'POST',
        headers: { origin: 'https://admin.test', 'x-csrf-token': 'csrf-token-123' },
      }),
      config,
      fetchImpl,
    );
    expect(res.status).toBe(204);
    expect(fetchImpl.mock.calls[2]![0]).toBe('http://backend.test/api/admin/auth/logout');
    expect(res.cookies.every((c) => c.options.maxAge === 0)).toBe(true);
  });
});

describe('configuration et CSRF', () => {
  it('cookies Secure par défaut en production ; URL du backend validée', () => {
    expect(readServerConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv).secureCookies).toBe(
      true,
    );
    expect(readServerConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).secureCookies).toBe(
      false,
    );
    expect(() =>
      readServerConfig({ ADMIN_API_URL: 'ftp://x' } as unknown as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it('les lectures (GET) ne demandent pas de jeton CSRF', () => {
    expect(
      checkCsrf({
        method: 'GET',
        origin: null,
        expected: 'x',
        headerToken: null,
        cookieToken: undefined,
        requireToken: true,
      }),
    ).toBeNull();
  });
});
