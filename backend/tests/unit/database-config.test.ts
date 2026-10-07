import { poolConfig } from '../../src/config/database';

describe('poolConfig', () => {
  it("borne l'attente d'une connexion et la durée des requêtes et transactions", () => {
    const config = poolConfig('postgres://u:p@localhost:5433/le_ter');

    expect(config.connectionString).toBe('postgres://u:p@localhost:5433/le_ter');
    expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(config.statement_timeout).toBeGreaterThan(0);
    expect(config.idle_in_transaction_session_timeout).toBeGreaterThan(0);
    expect(config.query_timeout).toBeGreaterThan(0);
    expect(config.max).toBeGreaterThan(0);
  });
});
