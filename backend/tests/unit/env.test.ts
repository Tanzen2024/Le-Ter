import { readEnv } from '../../src/config/env';

const SECRET = 'x'.repeat(48);

describe('readEnv', () => {
  it('applique les valeurs par défaut', () => {
    expect(readEnv({})).toEqual({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: undefined,
      redisUrl: undefined,
      auth: { jwtSecret: undefined, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 2_592_000 },
    });
  });

  it('lit PORT, NODE_ENV, DATABASE_URL et REDIS_URL', () => {
    expect(
      readEnv({
        NODE_ENV: 'test',
        PORT: '4000',
        DATABASE_URL: 'postgres://le_ter:secret@localhost:5432/le_ter',
        REDIS_URL: 'redis://localhost:6379',
      }),
    ).toEqual({
      nodeEnv: 'test',
      port: 4000,
      databaseUrl: 'postgres://le_ter:secret@localhost:5432/le_ter',
      redisUrl: 'redis://localhost:6379',
      auth: { jwtSecret: undefined, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 2_592_000 },
    });
  });

  it('traite une URL vide comme absente', () => {
    expect(readEnv({ DATABASE_URL: '  ', REDIS_URL: '' })).toMatchObject({
      databaseUrl: undefined,
      redisUrl: undefined,
    });
  });

  it("rejette une URL de base d'un autre protocole", () => {
    expect(() => readEnv({ DATABASE_URL: 'mongodb://localhost:27017/le-ter' })).toThrow(
      'DATABASE_URL invalide',
    );
    expect(() => readEnv({ REDIS_URL: 'http://localhost:6379' })).toThrow('REDIS_URL invalide');
  });

  it("ne recopie jamais une URL mal formée dans l'erreur", () => {
    expect(() => readEnv({ DATABASE_URL: 'pas une url:secret' })).toThrow(
      /^DATABASE_URL invalide : URL mal formée$/,
    );
  });

  it('rejette un PORT invalide', () => {
    expect(() => readEnv({ PORT: 'abc' })).toThrow('PORT invalide');
  });

  it('exige DATABASE_URL en production : PostgreSQL est la source de vérité', () => {
    expect(() => readEnv({ NODE_ENV: 'production' })).toThrow('DATABASE_URL requis en production');
    expect(
      readEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/le_ter',
        JWT_SECRET: SECRET,
      }),
    ).toMatchObject({ nodeEnv: 'production', redisUrl: undefined });
  });

  it('exige JWT_SECRET en production, sans valeur par défaut', () => {
    expect(() =>
      readEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/le_ter' }),
    ).toThrow('JWT_SECRET requis en production');
    expect(readEnv({}).auth.jwtSecret).toBeUndefined();
  });

  it('refuse un JWT_SECRET trop court sans le recopier dans l’erreur', () => {
    expect(() => readEnv({ JWT_SECRET: 'court-secret' })).toThrow(/^JWT_SECRET invalide : 32/);
    expect(() => readEnv({ JWT_SECRET: 'court-secret' })).not.toThrow(/court-secret/);
  });

  it('lit les durées des jetons (15m et 30d par défaut)', () => {
    expect(
      readEnv({
        JWT_SECRET: SECRET,
        JWT_ACCESS_TOKEN_EXPIRES_IN: '10m',
        REFRESH_TOKEN_EXPIRES_IN: '7d',
      }).auth,
    ).toEqual({ jwtSecret: SECRET, accessTokenTtlSeconds: 600, refreshTokenTtlSeconds: 604_800 });
    expect(() => readEnv({ JWT_ACCESS_TOKEN_EXPIRES_IN: '15 minutes' })).toThrow(
      'JWT_ACCESS_TOKEN_EXPIRES_IN invalide',
    );
  });

  it('rejette un NODE_ENV inconnu', () => {
    expect(() => readEnv({ NODE_ENV: 'staging' })).toThrow('NODE_ENV invalide');
  });
});
