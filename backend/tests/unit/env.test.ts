import { readEnv } from '../../src/config/env';

describe('readEnv', () => {
  it('applique les valeurs par défaut', () => {
    expect(readEnv({})).toEqual({ nodeEnv: 'development', port: 3000, mongodbUri: undefined });
  });

  it('lit PORT, NODE_ENV et MONGODB_URI', () => {
    expect(
      readEnv({ NODE_ENV: 'test', PORT: '4000', MONGODB_URI: 'mongodb://localhost:27017/le-ter' }),
    ).toEqual({ nodeEnv: 'test', port: 4000, mongodbUri: 'mongodb://localhost:27017/le-ter' });
  });

  it('rejette un PORT invalide', () => {
    expect(() => readEnv({ PORT: 'abc' })).toThrow('PORT invalide');
  });

  it('rejette un NODE_ENV inconnu', () => {
    expect(() => readEnv({ NODE_ENV: 'staging' })).toThrow('NODE_ENV invalide');
  });
});
