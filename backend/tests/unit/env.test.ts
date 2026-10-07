import { readEnv } from '../../src/config/env';

describe('readEnv', () => {
  it('applique les valeurs par défaut', () => {
    expect(readEnv({})).toEqual({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: undefined,
      redisUrl: undefined,
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

  it('rejette un NODE_ENV inconnu', () => {
    expect(() => readEnv({ NODE_ENV: 'staging' })).toThrow('NODE_ENV invalide');
  });
});
