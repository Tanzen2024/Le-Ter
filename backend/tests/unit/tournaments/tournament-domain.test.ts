import {
  accountStatusFor,
  canPlayTournamentGame,
  minimumTokensToPlay,
  canTransition,
  coefficientHundredths,
  computePool,
  computePrizes,
  DEFAULT_TOURNAMENT_SETTINGS,
  InvalidTournamentError,
  percentToBps,
  prizeRulesError,
  registrationWindowOpen,
  settleGameTokens,
  tokenCoefficientsError,
  tournamentDurationError,
  TOURNAMENT_STATUSES,
  tournamentLabel,
  tournamentTokenSetup,
  validateTournamentInput,
  type TournamentInput,
} from '../../../src/domain/tournaments/tournament';

/** Logique pure des tournois financiers (D-054). */
const NOW = new Date('2026-10-12T10:00:00Z');
const at = (iso: string) => new Date(iso);

function input(overrides: Partial<TournamentInput> = {}): TournamentInput {
  return {
    gameType: 'TER',
    startsAt: at('2026-10-12T18:00:00Z'),
    endsAt: at('2026-10-12T20:00:00Z'),
    entryFee: 1000,
    minimumPlayers: 20,
    maximumPlayers: 100,
    prizeRules: [
      { rank: 1, shareBps: 5000 },
      { rank: 2, shareBps: 3000 },
      { rank: 3, shareBps: 2000 },
    ],
    ...overrides,
  };
}

const validate = (i: TournamentInput, creatorType: 'ADMIN' | 'PLAYER' = 'ADMIN') =>
  validateTournamentInput(i, { now: NOW, creatorType, settings: DEFAULT_TOURNAMENT_SETTINGS });

function fieldsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidTournamentError);
    return Object.keys((err as InvalidTournamentError).fields);
  }
  throw new Error('aurait dû être refusé');
}

describe('machine à états', () => {
  it('suit le cycle complet, une étape à la fois', () => {
    const path = [
      'DRAFT',
      'PENDING_APPROVAL',
      'SCHEDULED',
      'REGISTRATION_OPEN',
      'REGISTRATION_CLOSED',
      'STARTING',
      'IN_PROGRESS',
      'CALCULATING_RESULTS',
      'RESULTS_VALIDATED',
      'DISTRIBUTING_PRIZES',
      'COMPLETED',
    ] as const;
    for (let i = 0; i + 1 < path.length; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it.each([
    ['COMPLETED', 'IN_PROGRESS'],
    ['CANCELLED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'CANCELLED'],
    ['IN_PROGRESS', 'COMPLETED'],
    ['DRAFT', 'IN_PROGRESS'],
    ['REGISTRATION_OPEN', 'IN_PROGRESS'],
  ] as const)('interdit %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('annulation possible avant la capture seulement ; états finaux sans sortie', () => {
    for (const status of TOURNAMENT_STATUSES) {
      const before = [
        'DRAFT',
        'PENDING_APPROVAL',
        'SCHEDULED',
        'REGISTRATION_OPEN',
        'REGISTRATION_CLOSED',
        'STARTING',
      ];
      expect(canTransition(status, 'CANCELLED')).toBe(before.includes(status));
    }
  });
});

describe('règles de durée (D-058) et de participants (D-057)', () => {
  const START = at('2026-10-12T18:00:00Z');
  const lasting = (minutes: number) =>
    input({ startsAt: START, endsAt: new Date(START.getTime() + minutes * 60_000) });

  it.each([
    [30, false],
    [44, false],
    [45, true],
    [120, true],
    [121, false],
  ])('durée de %i minutes (45 à 120 par défaut) : acceptée = %s', (minutes, accepted) => {
    for (const creator of ['ADMIN', 'PLAYER'] as const) {
      if (accepted) expect(() => validate(lasting(minutes), creator)).not.toThrow();
      else expect(fieldsOf(() => validate(lasting(minutes), creator))).toContain('endsAt');
    }
  });

  it.each([44, 121])('durée de %i minutes : message exact', (minutes) => {
    expect(tournamentDurationError(DEFAULT_TOURNAMENT_SETTINGS)).toBe(
      'Durée entre 45 minutes et 120 minutes.',
    );
    try {
      validate(lasting(minutes));
      throw new Error('aurait dû être refusé');
    } catch (err) {
      expect((err as InvalidTournamentError).fields.endsAt).toBe(
        'Durée entre 45 minutes et 120 minutes.',
      );
    }
  });

  it('une seconde de part et d’autre des bornes suffit à refuser', () => {
    const lastingMs = (ms: number) =>
      input({ startsAt: START, endsAt: new Date(START.getTime() + ms) });
    expect(fieldsOf(() => validate(lastingMs(45 * 60_000 - 1000)))).toContain('endsAt');
    expect(fieldsOf(() => validate(lastingMs(120 * 60_000 + 1000)))).toContain('endsAt');
  });

  it('prix d’entrée minimal réglé par l’administration : borne et message suivent les paramètres', () => {
    const at = (entryFee: number, minimum = 500) => () =>
      validateTournamentInput(input({ entryFee }), {
        now: NOW,
        creatorType: 'ADMIN',
        settings: { ...DEFAULT_TOURNAMENT_SETTINGS, tournamentMinimumEntryFee: minimum },
      });
    expect(DEFAULT_TOURNAMENT_SETTINGS.tournamentMinimumEntryFee).toBe(500);
    expect(at(500)).not.toThrow();
    expect(fieldsOf(at(499))).toContain('entryFee');
    expect(at(2000, 2000)).not.toThrow();
    try {
      at(1999, 2000)();
      throw new Error('aurait dû être refusé');
    } catch (err) {
      expect((err as InvalidTournamentError).fields.entryFee).toBe(
        'Montant entier entre 2000 et 100000.',
      );
    }
  });
  it('durées réglées par l’administration : bornes et message suivent les paramètres', () => {
    const settings = {
      ...DEFAULT_TOURNAMENT_SETTINGS,
      tournamentMinimumDurationMinutes: 30,
      tournamentMaximumDurationMinutes: 180,
    };
    const check = (minutes: number) => () =>
      validateTournamentInput(lasting(minutes), { now: NOW, creatorType: 'ADMIN', settings });
    expect(check(30)).not.toThrow();
    expect(check(180)).not.toThrow();
    for (const minutes of [29, 181]) {
      try {
        check(minutes)();
        throw new Error('aurait dû être refusé');
      } catch (err) {
        expect((err as InvalidTournamentError).fields.endsAt).toBe(
          'Durée entre 30 minutes et 180 minutes.',
        );
      }
    }
    expect(DEFAULT_TOURNAMENT_SETTINGS).toMatchObject({
      tournamentMinimumDurationMinutes: 45,
      tournamentMaximumDurationMinutes: 120,
    });
  });

  it.each([
    [{ minimumPlayers: 19 }, 'minimumPlayers'],
    [{ minimumPlayers: 20, maximumPlayers: 19 }, 'maximumPlayers'],
    [{ minimumPlayers: 2, maximumPlayers: 10 }, 'maximumPlayers'],
  ] as const)('participants refusés : %j (%s)', (overrides, field) => {
    for (const creator of ['ADMIN', 'PLAYER'] as const) {
      expect(fieldsOf(() => validate(input(overrides), creator))).toContain(field);
    }
  });

  it.each([
    { minimumPlayers: 20, maximumPlayers: 20 },
    { minimumPlayers: 20, maximumPlayers: 1000 },
    { minimumPlayers: 1000, maximumPlayers: 1000 },
    { minimumPlayers: 20, maximumPlayers: undefined },
    // Aucun plafond par défaut (∞).
    { minimumPlayers: 20, maximumPlayers: 1001 },
    { minimumPlayers: 1001, maximumPlayers: undefined },
    { minimumPlayers: 20, maximumPlayers: 1_000_000 },
  ])('participants acceptés : %j', (overrides) => {
    for (const creator of ['ADMIN', 'PLAYER'] as const) {
      expect(() => validate(input(overrides), creator)).not.toThrow();
    }
  });

  it('bornes réglées par l’administration : minimum et maximum appliqués à la création', () => {
    const settings = {
      ...DEFAULT_TOURNAMENT_SETTINGS,
      tournamentMinimumPlayers: 30,
      tournamentMaximumPlayers: 100,
    };
    const check = (overrides: Partial<TournamentInput>) =>
      fieldsOf(() =>
        validateTournamentInput(input(overrides), { now: NOW, creatorType: 'ADMIN', settings }),
      );
    expect(check({ minimumPlayers: 29, maximumPlayers: 50 })).toContain('minimumPlayers');
    expect(check({ minimumPlayers: 30, maximumPlayers: 101 })).toContain('maximumPlayers');
    expect(check({ minimumPlayers: 101, maximumPlayers: undefined })).toContain('minimumPlayers');
    expect(() =>
      validateTournamentInput(input({ minimumPlayers: 30, maximumPlayers: 100 }), {
        now: NOW,
        creatorType: 'ADMIN',
        settings,
      }),
    ).not.toThrow();
    expect(DEFAULT_TOURNAMENT_SETTINGS).toMatchObject({
      tournamentMinimumPlayers: 20,
      tournamentMaximumPlayers: null,
    });
  });
});

describe('validation', () => {
  it('sans nom ni description (D-060) : accepté, rien de tel dans le résultat', () => {
    const v = validate(input());
    expect(v).not.toHaveProperty('name');
    expect(v).not.toHaveProperty('description');
  });

  it('libellé calculé (jamais stocké) : date et heure dans le fuseau du tournoi', () => {
    expect(tournamentLabel(at('2026-10-12T17:00:00Z'), 'Africa/Douala')).toBe(
      'Tournoi du 12/10/2026 18:00',
    );
  });

  it('accepte un tournoi valide ; jetons et mise calculés avec les coefficients (D-071)', () => {
    const v = validate(input());
    expect(v.initialTournamentTokens).toBe(10_000);
    expect(v.stakePerGame).toBe(500);
    expect(v.timezone).toBe('Africa/Douala');
  });

  it('un joueur doit proposer au moins 1 h à l’avance', () => {
    const soon = input({
      startsAt: at('2026-10-12T10:30:00Z'),
      endsAt: at('2026-10-12T12:00:00Z'),
    });
    expect(fieldsOf(() => validate(soon, 'PLAYER'))).toContain('startsAt');
    expect(() => validate(soon, 'ADMIN')).not.toThrow();
  });

  it('D-108 : à l’approbation, le début doit seulement être à venir', () => {
    const approve = (startsAt: string) => () =>
      validateTournamentInput(
        input({ startsAt: at(startsAt), endsAt: at('2026-10-12T12:00:00Z') }),
        { now: NOW, creatorType: 'PLAYER', settings: DEFAULT_TOURNAMENT_SETTINGS, approval: true },
      );
    expect(approve('2026-10-12T10:05:00Z')).not.toThrow();
    expect(fieldsOf(approve('2026-10-12T10:00:00Z'))).toEqual(['startsAt']);
  });

  it.each([
    [{ startsAt: at('2026-10-12T09:00:00Z') }, 'startsAt'],
    [{ endsAt: at('2026-10-12T18:10:00Z') }, 'endsAt'],
    [{ endsAt: at('2026-10-14T18:00:00Z') }, 'endsAt'],
    [{ entryFee: -1 }, 'entryFee'],
    [{ entryFee: 0 }, 'entryFee'],
    [{ entryFee: 499 }, 'entryFee'],
    [{ entryFee: 100_001 }, 'entryFee'],
    [{ entryFee: 1000.5 }, 'entryFee'],
    [{ minimumPlayers: 1 }, 'minimumPlayers'],
    [{ maximumPlayers: 10 }, 'maximumPlayers'],
    [{ timezone: 'Mars/Olympus' }, 'timezone'],
    [{ registrationClosesAt: at('2026-10-12T19:00:00Z') }, 'registrationClosesAt'],
  ] as const)('refuse %j (%s)', (overrides, field) => {
    expect(fieldsOf(() => validate(input(overrides as Partial<TournamentInput>)))).toContain(field);
  });

  it('valeurs figées (tournoi publié) conservées, revérifiées : mise ≤ moitié des jetons', () => {
    const frozen = (initialTournamentTokens: number, stakePerGame: number) =>
      validateTournamentInput(input({ entryFee: 2000 }), {
        now: NOW,
        creatorType: 'ADMIN',
        settings: DEFAULT_TOURNAMENT_SETTINGS,
        frozenTokens: { initialTournamentTokens, stakePerGame },
      });
    expect(frozen(1000, 500)).toMatchObject({ initialTournamentTokens: 1000, stakePerGame: 500 });
    expect(fieldsOf(() => frozen(1000, 501))).toContain('entryFee');
  });

  it('jetons calculés au-delà du plafond : prix refusé', () => {
    const settings = { ...DEFAULT_TOURNAMENT_SETTINGS, initialTokensCoefficient: 20 };
    expect(
      fieldsOf(() =>
        validateTournamentInput(input({ entryFee: 60_000 }), {
          now: NOW,
          creatorType: 'ADMIN',
          settings,
        }),
      ),
    ).toEqual(['entryFee']);
  });

  it.each([
    [
      [
        { rank: 1, shareBps: 5000 },
        { rank: 2, shareBps: 3000 },
      ],
      'somme 80 %',
    ],
    [
      [
        { rank: 1, shareBps: 6000 },
        { rank: 2, shareBps: 6000 },
      ],
      'somme 120 %',
    ],
    [
      [
        { rank: 1, shareBps: 5000 },
        { rank: 3, shareBps: 5000 },
      ],
      'rangs non consécutifs',
    ],
    [
      [
        { rank: 1, shareBps: 10000 },
        { rank: 2, shareBps: 0 },
      ],
      'part nulle',
    ],
    [[], 'aucun rang'],
  ])('répartition refusée : %j (%s)', (rules) => {
    expect(prizeRulesError(rules)).toBeDefined();
  });

  it('répartition 50/30/20 acceptée', () => {
    expect(prizeRulesError(input().prizeRules)).toBeUndefined();
  });
});

describe('cagnotte et commission', () => {
  it('100 000 brut, 10 % → commission 10 000, cagnotte 90 000', () => {
    expect(computePool(1000, 100, percentToBps(10))).toEqual({
      grossPool: 100_000,
      platformFee: 10_000,
      prizePool: 90_000,
    });
  });

  it('commission arrondie à l’entier inférieur (en faveur des joueurs)', () => {
    expect(computePool(333, 3, percentToBps(12.5))).toEqual({
      grossPool: 999,
      platformFee: 124,
      prizePool: 875,
    });
  });
});

describe('gains', () => {
  const rules = input().prizeRules;

  it('reste d’arrondi au 1er rang : 101 → 51 / 30 / 20', () => {
    const { prizes, unallocated } = computePrizes(101, rules, 10);
    expect(prizes.map((p) => p.amount)).toEqual([51, 30, 20]);
    expect(unallocated).toBe(0);
  });

  it('90 000 → 45 000 / 27 000 / 18 000', () => {
    expect(computePrizes(90_000, rules, 50).prizes.map((p) => p.amount)).toEqual([
      45_000, 27_000, 18_000,
    ]);
  });

  it('moins de classés que de rangs payés : part non attribuée, non redistribuée', () => {
    const { prizes, unallocated } = computePrizes(1000, rules, 2);
    expect(prizes.map((p) => [p.rank, p.amount])).toEqual([
      [1, 500],
      [2, 300],
    ]);
    expect(unallocated).toBe(200);
  });

  it('la somme versée + non attribuée = cagnotte, toujours', () => {
    for (const pool of [0, 1, 7, 99, 101, 12_345, 90_001]) {
      for (const ranked of [0, 1, 2, 3, 10]) {
        const { prizes, unallocated } = computePrizes(pool, rules, ranked);
        expect(prizes.reduce((s, p) => s + p.amount, 0) + unallocated).toBe(pool);
      }
    }
  });
});

// Classement pondéré (D-062) : tests/unit/tournaments/tournament-ranking.test.ts.

describe('règlement des jetons d’une partie', () => {
  it('4 joueurs, mise 100 : pot 400, le gagnant reçoit les 300 des autres', () => {
    const tokens = new Map([
      ['w', 1000],
      ['a', 1000],
      ['b', 1000],
      ['c', 1000],
    ]);
    expect(settleGameTokens(100, 'w', tokens)).toEqual({
      transfers: { a: -100, b: -100, c: -100, w: 300 },
      pot: 400,
    });
  });

  it('un perdant sans assez de jetons ne paie que ce qu’il a (jamais négatif)', () => {
    const { transfers } = settleGameTokens(
      100,
      'w',
      new Map([
        ['w', 500],
        ['a', 30],
      ]),
    );
    expect(transfers).toEqual({ a: -30, w: 30 });
  });

  it('le gagnant ne gagne pas plus que ce qu’il risque (tapis)', () => {
    const { transfers, pot } = settleGameTokens(
      100,
      'w',
      new Map([
        ['w', 40],
        ['a', 1000],
        ['b', 1000],
      ]),
    );
    expect(transfers).toEqual({ a: -40, b: -40, w: 80 });
    expect(pot).toBe(120);
  });

  it('aucun jeton créé ni détruit', () => {
    const tokens = new Map([
      ['w', 70],
      ['a', 250],
      ['b', 10],
      ['c', 0],
    ]);
    const { transfers } = settleGameTokens(100, 'w', tokens);
    expect(Object.values(transfers).reduce((s, v) => s + v, 0)).toBe(0);
  });

  describe('seuil de participation : jetons >= 2 × mise (D-063)', () => {
    it('seuil = deux mises', () => {
      expect(minimumTokensToPlay(100)).toBe(200);
      expect(minimumTokensToPlay(1)).toBe(2);
    });

    it.each([
      [200, 100, true, 'ACTIVE'], // exactement au seuil
      [199, 100, false, 'OUT_OF_TOKENS'], // juste en dessous
      [201, 100, true, 'ACTIVE'],
      [100, 100, false, 'OUT_OF_TOKENS'], // une seule mise ne suffit plus
      [0, 100, false, 'OUT_OF_TOKENS'],
      [1000, 500, true, 'ACTIVE'], // exemple de la règle : mise 500, seuil 1 000
      [999, 500, false, 'OUT_OF_TOKENS'],
      [2, 1, true, 'ACTIVE'],
      [1, 1, false, 'OUT_OF_TOKENS'],
    ] as const)('%i jetons, mise %i : peut jouer = %s (%s)', (tokens, stake, can, status) => {
      expect(canPlayTournamentGame(tokens, stake)).toBe(can);
      expect(accountStatusFor(tokens, stake)).toBe(status);
    });
  });
});

describe('coefficients des jetons de départ et de la mise (D-071)', () => {
  const settings = DEFAULT_TOURNAMENT_SETTINGS;

  it('valeurs initiales : commission 15, coefficients 10 et 0,5, poids 60 / 40', () => {
    expect(settings).toMatchObject({
      platformFeePercent: 15,
      initialTokensCoefficient: 10,
      stakePerGameCoefficient: 0.5,
      rankingTokensWeightPercent: 60,
      rankingGamesWeightPercent: 40,
      maximumPendingTournamentsPerPlayer: 1,
      tournamentTransitionMinutes: 0,
    });
  });

  it('prix 1 000 → 10 000 jetons, mise 500', () => {
    expect(tournamentTokenSetup(1000, settings)).toEqual({
      initialTournamentTokens: 10_000,
      stakePerGame: 500,
    });
  });

  it('prix 2 000 → 20 000 jetons, mise 1 000', () => {
    expect(tournamentTokenSetup(2000, settings)).toEqual({
      initialTournamentTokens: 20_000,
      stakePerGame: 1000,
    });
  });

  it('coefficients décimaux : calcul exact en centièmes, arrondi à l’entier inférieur', () => {
    const decimal = { initialTokensCoefficient: 2.35, stakePerGameCoefficient: 0.29 };
    // 1001 × 2,35 = 2352,35 → 2352 ; 1001 × 0,29 = 290,29 → 290 (0,29 × 100 n'est pas exact en flottant).
    expect(tournamentTokenSetup(1001, decimal)).toEqual({
      initialTournamentTokens: 2352,
      stakePerGame: 290,
    });
    expect(tournamentTokenSetup(501, settings).stakePerGame).toBe(250);
    expect(coefficientHundredths(0.5)).toBe(50);
    expect(coefficientHundredths(0.29)).toBe(29);
    expect(coefficientHundredths(10)).toBe(1000);
  });

  it('coefficients invalides détectés : plus de 2 décimales, non finis, mise > moitié', () => {
    expect(coefficientHundredths(0.125)).toBeUndefined();
    expect(coefficientHundredths(Number.NaN)).toBeUndefined();
    expect(coefficientHundredths(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(tokenCoefficientsError(settings)).toBeUndefined();
    expect(
      tokenCoefficientsError({ initialTokensCoefficient: 10, stakePerGameCoefficient: 5 }),
    ).toBeUndefined();
    expect(
      tokenCoefficientsError({ initialTokensCoefficient: 10, stakePerGameCoefficient: 5.01 }),
    ).toBeDefined();
    expect(
      tokenCoefficientsError({ initialTokensCoefficient: 0.001, stakePerGameCoefficient: 0.5 }),
    ).toBeDefined();
  });
});

describe('fenêtre d’inscription (D-054, D-108)', () => {
  const startsAt = at('2026-10-12T18:00:00Z');
  const open = (status: (typeof TOURNAMENT_STATUSES)[number], now: string, extra = {}) =>
    registrationWindowOpen({ status, startsAt, ...extra }, at(now));

  it('proposition en attente : préinscription ouverte jusqu’au début', () => {
    expect(open('PENDING_APPROVAL', '2026-10-12T10:00:00Z')).toBe(true);
    expect(open('PENDING_APPROVAL', '2026-10-12T17:59:59Z')).toBe(true);
    expect(open('PENDING_APPROVAL', '2026-10-12T18:00:00Z')).toBe(false);
  });

  it('proposition en attente : respecte l’ouverture et la clôture choisies', () => {
    const window = {
      registrationOpensAt: at('2026-10-12T12:00:00Z'),
      registrationClosesAt: at('2026-10-12T17:00:00Z'),
    };
    expect(open('PENDING_APPROVAL', '2026-10-12T11:00:00Z', window)).toBe(false);
    expect(open('PENDING_APPROVAL', '2026-10-12T13:00:00Z', window)).toBe(true);
    expect(open('PENDING_APPROVAL', '2026-10-12T17:00:00Z', window)).toBe(false);
  });

  it('brouillon, publié pas encore ouvert, clôturé, démarré, annulé : fermé', () => {
    for (const status of [
      'DRAFT',
      'SCHEDULED',
      'REGISTRATION_CLOSED',
      'STARTING',
      'IN_PROGRESS',
      'CANCELLED',
    ] as const) {
      expect(open(status, '2026-10-12T10:00:00Z')).toBe(false);
    }
    expect(open('REGISTRATION_OPEN', '2026-10-12T10:00:00Z')).toBe(true);
  });
});
