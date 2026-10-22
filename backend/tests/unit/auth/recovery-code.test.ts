import {
  generateRecoveryCode,
  generateResetToken,
  hashResetToken,
  isWellFormedResetToken,
  normalizeRecoveryCode,
  recoveryCodeSecret,
} from '../../../src/services/auth/recovery-code';
import { parseLoginInput, parseRegisterInput } from '../../../src/validators/auth.validators';

describe('code de récupération (D-135)', () => {
  it('format LT-XXXX-XXXX-XXXX, alphabet sans I, L, O, U ; jamais deux fois le même', () => {
    const codes = new Set(Array.from({ length: 500 }, generateRecoveryCode));
    expect(codes.size).toBe(500);
    for (const code of codes) {
      expect(code).toMatch(/^LT(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    }
  });

  it('saisie libre : minuscules, espaces, sans tirets ni préfixe, O/I/L confondus', () => {
    const canonical = normalizeRecoveryCode('LT-7K4P-92XM-0A1B');
    expect(canonical).toBe('7K4P92XM0A1B');
    for (const typed of ['lt 7k4p 92xm 0a1b', '7K4P92XM0A1B', 'LT-7K4P-92XM-OAIB', '7k4p-92xm-oalb']) {
      expect(normalizeRecoveryCode(typed)).toBe(canonical);
    }
    expect(recoveryCodeSecret('lt-7k4p-92xm-0a1b')).toBe(canonical);
  });

  it('forme impossible : refusée sans comparaison', () => {
    for (const bad of ['', 'LT-7K4P', '7K4P92XM0A1BZ', 'LT-7K4P-92XM-0A1U', '!!!!!!!!!!!!']) {
      expect(normalizeRecoveryCode(bad)).toBeNull();
    }
    expect(() => recoveryCodeSecret('court')).toThrow(RangeError);
  });

  it('autorisation de réinitialisation : 43 caractères, seule l’empreinte est stockée', () => {
    const { token, hash } = generateResetToken();
    expect(isWellFormedResetToken(token)).toBe(true);
    expect(hash).toBe(hashResetToken(token));
    expect(hash).not.toContain(token);
    expect(isWellFormedResetToken('x')).toBe(false);
  });
});

describe('validation (D-135)', () => {
  const registration = {
    firstName: 'Awa',
    lastName: 'Ndiaye',
    username: 'awa_1',
    country: 'CM',
    phone: '670000001',
    password: 'Secret123',
    confirmPassword: 'Secret123',
  };

  it('inscription sans email : email null ; email fourni mais invalide : refusé', () => {
    expect(parseRegisterInput(registration).email).toBeNull();
    expect(parseRegisterInput({ ...registration, email: '  ' }).email).toBeNull();
    expect(() => parseRegisterInput({ ...registration, email: 'pas-un-email' })).toThrow();
  });

  it('connexion par téléphone : E.164 reconstruit ; pays obligatoire', () => {
    expect(parseLoginInput({ country: 'CM', phone: '6 70 00 00 01', password: 'x' })).toEqual({
      phone: '+237670000001',
      password: 'x',
    });
    expect(() => parseLoginInput({ phone: '670000001', password: 'x' })).toThrow();
  });
});
