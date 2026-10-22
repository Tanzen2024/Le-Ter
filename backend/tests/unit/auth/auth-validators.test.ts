import express from 'express';
import request from 'supertest';

import { createRateLimiter } from '../../../src/middleware/rate-limit';
import {
  normalizePhone,
  parseLoginInput,
  parseRegisterInput,
} from '../../../src/validators/auth.validators';
import { ValidationError } from '../../../src/validators/validation-error';

const valid = {
  firstName: '  Jean-Marc ',
  lastName: "N'Diaye",
  email: '  Jean.Marc@Example.COM ',
  username: 'JeanMarc_237',
  country: 'CM',
  phone: '+237 6 99-12.34.56',
  password: 'Secret123',
  confirmPassword: 'Secret123',
};

function fieldErrors(body: unknown): Record<string, string> {
  try {
    parseRegisterInput(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      return err.fields;
    }
    throw err;
  }
  return {};
}

describe('Inscription — validation et normalisation (R-15)', () => {
  it('normalise email (minuscules), téléphone (E.164) et noms', () => {
    expect(parseRegisterInput(valid)).toEqual({
      firstName: 'Jean-Marc',
      lastName: "N'Diaye",
      email: 'jean.marc@example.com',
      username: 'JeanMarc_237',
      phone: '+237699123456',
      password: 'Secret123',
    });
  });

  it('exige les 7 champs obligatoires (pays compris ; email facultatif, D-135)', () => {
    expect(Object.keys(fieldErrors({})).sort()).toEqual([
      'confirmPassword',
      'country',
      'firstName',
      'lastName',
      'password',
      'phone',
      'username',
    ]);
    expect(Object.keys(fieldErrors(null))).toHaveLength(7);
  });

  it.each([
    ['email', 'pas-un-email'],
    ['email', 'a@b'],
    ['username', 'ab'],
    ['username', 'pseudo avec espace'],
    ['username', 'p'.repeat(21)],
    ['phone', '600000001'],
    ['phone', '69912345'],
    ['phone', '+0123456789'],
    ['phone', '+12'],
    ['phone', '+237abc'],
    ['firstName', '123'],
    ['lastName', 'x'.repeat(51)],
  ])('refuse %s = %j', (field, value) => {
    expect(fieldErrors({ ...valid, [field]: value })).toHaveProperty(field);
  });

  it.each([
    ['trop court', 'Abc123'],
    ['sans chiffre', 'Motdepasse'],
    ['sans lettre', '12345678'],
    ['plus de 72 octets', `A1${'é'.repeat(40)}`],
  ])('refuse un mot de passe faible (%s)', (_label, password) => {
    expect(fieldErrors({ ...valid, password, confirmPassword: password })).toHaveProperty(
      'password',
    );
  });

  it('refuse une confirmation différente', () => {
    expect(fieldErrors({ ...valid, confirmPassword: 'Secret124' })).toEqual({
      confirmPassword: 'Les mots de passe ne correspondent pas.',
    });
  });

  it('ne renvoie ni confirmPassword ni les champs non attendus (id, role, phoneVerified)', () => {
    const parsed = parseRegisterInput({ ...valid, id: 'x', role: 'admin', phoneVerified: true });
    expect(Object.keys(parsed).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
      'password',
      'phone',
      'username',
    ]);
  });

  it.each([
    ['CM', '692130271', '+237692130271'],
    ['CM', '6 92 13 02 71', '+237692130271'],
    ['CM', '+237692130271', '+237692130271'],
    ['cm', '692-13-02-71', '+237692130271'],
    ['FR', '06 12 34 56 78', '+33612345678'],
    ['CI', '07 07 07 07 07', '+2250707070707'],
    ['SN', '77 123 45 67', '+221771234567'],
  ])('pays %s + numéro %j → %s (E.164 reconstruit)', (country, phone, e164) => {
    expect(parseRegisterInput({ ...valid, country, phone }).phone).toBe(e164);
  });

  it('refuse un indicatif d’un autre pays que celui choisi', () => {
    expect(fieldErrors({ ...valid, country: 'CM', phone: '+33612345678' })).toEqual({
      phone: 'Numéro invalide pour le pays sélectionné.',
    });
    expect(fieldErrors({ ...valid, country: 'FR', phone: '692130271' })).toEqual({
      phone: 'Numéro invalide pour le pays sélectionné.',
    });
  });

  it('pays absent ou inconnu : erreur sur le pays, jamais d’indicatif deviné', () => {
    expect(fieldErrors({ ...valid, country: undefined })).toEqual({
      country: 'Ce champ est obligatoire.',
    });
    expect(fieldErrors({ ...valid, country: 'ZZ' })).toEqual({
      country: 'Pays non pris en charge.',
    });
  });

  it('accepte le préfixe international « 00 »', () => {
    expect(normalizePhone('00237 699 12 34 56')).toBe('+237699123456');
  });
});

describe('Connexion — validation', () => {
  it('exige email et mot de passe, normalise l’email', () => {
    expect(parseLoginInput({ email: ' A@B.CM ', password: 'x' })).toEqual({
      email: 'a@b.cm',
      password: 'x',
    });
    expect(() => parseLoginInput({ email: 'a@b.cm' })).toThrow(ValidationError);
  });
});

describe('createRateLimiter', () => {
  it('renvoie 429 au-delà de la limite, avec Retry-After, puis rouvre la fenêtre', async () => {
    let now = 0;
    const app = express();
    app.post(
      '/x',
      createRateLimiter({ name: 't', windowMs: 1000, max: 2, clock: () => now }),
      (_r, res) => {
        res.sendStatus(204);
      },
    );

    await request(app).post('/x').expect(204);
    await request(app).post('/x').expect(204);
    const limited = await request(app).post('/x').expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBe('1');

    now = 1000;
    await request(app).post('/x').expect(204);
  });
});
