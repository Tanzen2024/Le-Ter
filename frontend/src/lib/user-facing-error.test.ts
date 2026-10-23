/// <reference types="jest" />
import { ApiError, userErrorMessage } from './api-client';
import {
  GENERIC_ERROR_MESSAGE,
  looksTechnical,
  SERVER_ERROR_MESSAGE,
} from './user-facing-error';

describe('aucun message d’erreur technique à l’écran', () => {
  it.each([
    'TypeError: Cannot read properties of undefined (reading "id")',
    'Network request failed',
    'Unexpected token < in JSON at position 0',
    'Internal Server Error',
    'Bad Gateway',
    'duplicate key value violates unique constraint "games_pkey"',
    'connect ECONNREFUSED 127.0.0.1:3000',
    'Partie 3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f introuvable',
    'Cette clé d’idempotence a déjà servi pour une autre création.',
    'Identifiant de session invalide.',
    'Refus GARAM_ACTION_NOT_ALLOWED',
    '{"error":"oops"}',
    'http://192.168.1.10:3000/api/games',
    '',
  ])('« %s » est technique', (text) => {
    expect(looksTechnical(text)).toBe(true);
  });

  it.each([
    "Ce n'est pas votre tour.",
    'Solde insuffisant.',
    'Vous devez disposer d’au moins 200 jetons pour jouer avec une mise de 100 jetons.',
    'Le paiement direct n’est pas disponible pour cet opérateur. Payez par la page CinetPay.',
    'Numéro d’inscription au format international attendu (ex. +237692130271).',
    'Impossible de joindre le serveur. Vérifiez votre connexion.',
    'Trop de messages. Patientez quelques secondes.',
  ])('« %s » est lisible par le joueur : affiché tel quel', (text) => {
    expect(looksTechnical(text)).toBe(false);
    expect(new ApiError(409, 'ANY', text).message).toBe(text);
  });

  it('message technique du serveur : remplacé par une phrase simple', () => {
    expect(new ApiError(400, 'X', 'Expected string, received number').message).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(new ApiError(500, 'INTERNAL', 'Internal Server Error').message).toBe(SERVER_ERROR_MESSAGE);
    expect(new ApiError(502, 'HTTP_ERROR', 'Bad Gateway').message).toBe(SERVER_ERROR_MESSAGE);
    expect(new ApiError(404, 'HTTP_ERROR', 'Cannot GET /api/x').message).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('codes au vocabulaire interne : reformulés pour le joueur', () => {
    expect(
      new ApiError(409, 'VERSION_CONFLICT', 'La partie a changé entre-temps. Rechargez son état.')
        .message,
    ).toBe('La partie vient de changer. Réessayez.');
    expect(new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'Clé déjà utilisée.').message).toBe(
      'Cette demande a déjà été envoyée. Réessayez.',
    );
  });

  it('5xx rédigés pour le joueur (paiement, maintenance) : conservés', () => {
    const text = 'Service momentanément indisponible. Réessayez dans quelques instants.';
    expect(new ApiError(503, 'SERVICE_TEMPORARILY_UNAVAILABLE', text).message).toBe(text);
  });

  it('messages par champ : un texte technique devient « Valeur invalide. »', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Données invalides.', {
      phone: 'Numéro invalide.',
      stake: 'must be a positive integer (received NaN)',
    });
    expect(err.fields).toEqual({ phone: 'Numéro invalide.', stake: 'Valeur invalide.' });
  });

  it('erreur JavaScript quelconque : jamais affichée, repli à la place', () => {
    expect(userErrorMessage(new TypeError('x is undefined'))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userErrorMessage('boom', 'Paiement indisponible.')).toBe('Paiement indisponible.');
    expect(userErrorMessage(new ApiError(409, 'SESSION_FULL', 'Cette partie est complète.'))).toBe(
      'Cette partie est complète.',
    );
  });
});
