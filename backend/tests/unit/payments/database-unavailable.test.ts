import { isDatabaseUnavailable } from '../../../src/middleware/api-errors';

/** Base momentanément injoignable (D-091) → 503 ; jamais une erreur de requête ou de contrainte. */
describe('isDatabaseUnavailable', () => {
  const withCode = (code: string, message = 'x') => Object.assign(new Error(message), { code });

  it.each([
    new Error('Connection terminated due to connection timeout'),
    new Error('Connection terminated unexpectedly'),
    new Error('timeout exceeded when trying to connect'),
    withCode('ECONNREFUSED'),
    withCode('ECONNRESET'),
    withCode('08006'),
    withCode('57P01'),
    withCode('53300'),
  ])('connexion perdue : %p', (err) => {
    expect(isDatabaseUnavailable(err)).toBe(true);
  });

  it.each([
    withCode('23505', 'duplicate key value violates unique constraint'),
    withCode('23514', 'violates check constraint'),
    withCode('57014', 'canceling statement due to statement timeout'),
    new Error('Montant invalide'),
    'Connection terminated',
    undefined,
  ])('pas une indisponibilité : %p', (err) => {
    expect(isDatabaseUnavailable(err)).toBe(false);
  });
});
