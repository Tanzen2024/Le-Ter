import { describe, expect, it } from 'vitest';

import { periodRange } from '@/features/shared/period';
import { availableActions, tournamentLabel } from '@/features/tournaments/api';
import { formatDuration, formatXaf, localDay } from '@/lib/format';
import { loginSchema, safeNextPath } from '@/lib/validation/login';
import { toTournamentPayload, tournamentFormSchema } from '@/lib/validation/tournament';

describe('connexion', () => {
  it('format des identifiants vérifié avant tout appel', () => {
    expect(loginSchema.safeParse({ email: 'pas-un-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'admin@le-ter.test', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: ' admin@le-ter.test ', password: 'x' }).success).toBe(
      true,
    );
  });

  it('redirection après connexion : chemins internes seulement (pas de redirection ouverte)', () => {
    expect(safeNextPath('/joueurs')).toBe('/joueurs');
    expect(safeNextPath('https://evil.test')).toBe('/tableau-de-bord');
    expect(safeNextPath('//evil.test')).toBe('/tableau-de-bord');
    expect(safeNextPath('/\\evil.test')).toBe('/tableau-de-bord');
    expect(safeNextPath('/api/admin/users')).toBe('/tableau-de-bord');
    expect(safeNextPath(null)).toBe('/tableau-de-bord');
  });
});

describe('création de tournoi', () => {
  it('heure saisie en Africa/Douala (UTC+1), durée convertie en fin, rangs numérotés', () => {
    const values = tournamentFormSchema.parse({
      gameType: 'TER',
      date: '2026-10-20',
      time: '20:00',
      durationMinutes: '60',
      entryFee: '1000',
      minimumPlayers: '20',
      maximumPlayers: '',
      prizeRules: [{ percent: '50' }, { percent: '30,5' }, { percent: '19.5' }],
    });
    expect(toTournamentPayload(values)).toEqual({
      gameType: 'TER',
      timezone: 'Africa/Douala',
      startsAt: '2026-10-20T19:00:00.000Z',
      endsAt: '2026-10-20T20:00:00.000Z',
      entryFee: 1000,
      minimumPlayers: 20,
      prizeRules: [
        { rank: 1, percent: 50 },
        { rank: 2, percent: 30.5 },
        { rank: 3, percent: 19.5 },
      ],
    });
  });

  it('les règles métier restent au serveur : seul le format est contrôlé ici', () => {
    // 10 minutes est accepté par le formulaire : c'est le serveur qui refuse (30 à 120 min).
    const parsed = tournamentFormSchema.safeParse({
      gameType: 'GARAM',
      garamVariant: '18',
      date: '2026-10-20',
      time: '20:00',
      durationMinutes: '10',
      entryFee: '1000',
      minimumPlayers: '2',
      maximumPlayers: '',
      prizeRules: [{ percent: '100' }],
    });
    expect(parsed.success).toBe(true);
    expect(
      tournamentFormSchema.safeParse({
        date: '',
        time: 'x',
        durationMinutes: 'abc',
        entryFee: '-1',
        minimumPlayers: '',
        maximumPlayers: 'x',
        prizeRules: [],
      }).success,
    ).toBe(false);
  });

  it('jeu du tournoi (D-124) : obligatoire, aucune valeur par défaut ni valeur inconnue', () => {
    const base = {
      date: '2026-10-20',
      time: '20:00',
      durationMinutes: '60',
      entryFee: '1000',
      minimumPlayers: '20',
      maximumPlayers: '',
      prizeRules: [{ percent: '100' }],
    };
    for (const gameType of [undefined, null, '', 'FAP_FAP', 'ter']) {
      const parsed = tournamentFormSchema.safeParse({ ...base, gameType });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.find((i) => i.path[0] === 'gameType')?.message).toBe(
        'Veuillez sélectionner le jeu du tournoi.',
      );
    }
    expect(
      toTournamentPayload(tournamentFormSchema.parse({ ...base, gameType: 'GARAM', garamVariant: '15' })),
    ).toEqual(expect.objectContaining({ gameType: 'GARAM', garamVariant: 15 }));
  });

  it('variante GARAM TIA (D-127) : obligatoire pour GARAM, aucune par défaut, absente pour Fap-Fap', () => {
    const base = {
      date: '2026-10-20',
      time: '20:00',
      durationMinutes: '60',
      entryFee: '1000',
      minimumPlayers: '20',
      maximumPlayers: '',
      prizeRules: [{ percent: '100' }],
    };
    for (const garamVariant of [undefined, '14', '19', '']) {
      const parsed = tournamentFormSchema.safeParse({ ...base, gameType: 'GARAM', garamVariant });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.some((i) => i.path[0] === 'garamVariant')).toBe(true);
    }
    for (const v of ['15', '16', '17', '18'] as const) {
      const payload = toTournamentPayload(
        tournamentFormSchema.parse({ ...base, gameType: 'GARAM', garamVariant: v }),
      );
      expect(payload).toMatchObject({ gameType: 'GARAM', garamVariant: Number(v) });
    }
    const ter = toTournamentPayload(
      tournamentFormSchema.parse({ ...base, gameType: 'TER', garamVariant: '17' }),
    );
    expect(ter).not.toHaveProperty('garamVariant');
  });

  it('actions proposées selon le statut ; aucune pendant un démarrage ni un tournoi en cours', () => {
    expect(availableActions('PENDING_APPROVAL')).toEqual(['approve', 'reject']);
    expect(availableActions('REGISTRATION_OPEN')).toEqual(['cancel']);
    expect(availableActions('STARTING')).toEqual([]);
    expect(availableActions('IN_PROGRESS')).toEqual([]);
    expect(availableActions('COMPLETED')).toEqual([]);
  });

  it('libellé d’un tournoi sans nom : sa date de début dans son fuseau', () => {
    expect(tournamentLabel({ startsAt: '2026-10-20T19:00:00Z', timezone: 'Africa/Douala' })).toBe(
      'Tournoi du 20/10/2026 20:00',
    );
  });
});

describe('périodes et formats', () => {
  it('période en jours locaux Africa/Douala, bornes [from, to)', () => {
    // 9 oct. 2026 à 23:30 UTC = 10 oct. 00:30 à Douala.
    const now = new Date('2026-10-09T23:30:00Z');
    expect(localDay(now)).toBe('2026-10-10');
    expect(periodRange(7, now)).toEqual({
      from: '2026-10-03T23:00:00.000Z',
      to: '2026-10-10T23:00:00.000Z',
    });
  });

  it('montants et durées lisibles ; valeur absente affichée « — »', () => {
    expect(formatXaf(1500).replace(/\s/g, ' ')).toBe('1 500 FCFA');
    // Même convention que le mobile : espaces insécables U+00A0 (milliers et avant FCFA).
    expect(formatXaf(1500)).toBe('1 500 FCFA');
    expect(formatXaf(1250000)).toBe('1 250 000 FCFA');
    expect(formatXaf(0)).toBe('0 FCFA');
    expect(formatXaf(null)).toBe('—');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(150)).toBe('2 min 30 s');
    expect(formatDuration(3720)).toBe('1 h 2 min');
  });
});
