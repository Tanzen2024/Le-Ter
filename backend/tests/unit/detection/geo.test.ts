import {
  DETECTION_THRESHOLDS,
  GEOLOCATION_CONFIG,
} from '../../../src/domain/detection/detection-config';
import {
  EARTH_RADIUS_METERS,
  haversineMeters,
  pairDistances,
  playerPairs,
  roundCoordinate,
  roundDistance,
  type PositionSample,
} from '../../../src/domain/detection/geo';
import {
  findImpossibleTravel,
  findIncoherentLocation,
  findProximity,
} from '../../../src/domain/detection/geo-analysis';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { parsePositionInput } from '../../../src/validators/geolocation.validators';
import { ValidationError } from '../../../src/validators/validation-error';

/** Couche géographique de la détection (R-36, étape 2, D-046) : fonctions pures. */

const GAME = '00000000-0000-4000-8000-000000000001' as GameId;
const [A, B, C, D] = ['a', 'b', 'c', 'd'] as [PlayerId, PlayerId, PlayerId, PlayerId];
const T0 = new Date('2026-10-08T12:00:00Z').getTime();

/** ≈ 11,1 m par 0,0001° de latitude. */
const DOUALA = { latitude: 4.0511, longitude: 9.7679 };
const YAOUNDE = { latitude: 3.848, longitude: 11.5021 };
const north = (meters: number) => ({
  latitude: DOUALA.latitude + meters / 111_195,
  longitude: DOUALA.longitude,
});

const at = (
  playerId: PlayerId,
  where: { latitude: number; longitude: number },
  seconds: number,
  accuracyMeters = 10,
): PositionSample => ({
  gameId: GAME,
  playerId,
  ...where,
  accuracyMeters,
  capturedAt: new Date(T0 + seconds * 1000),
});

describe('TEST 7 — Haversine', () => {
  it('même point : 0 m ; symétrique', () => {
    expect(haversineMeters(DOUALA, DOUALA)).toBe(0);
    expect(haversineMeters(DOUALA, YAOUNDE)).toBeCloseTo(haversineMeters(YAOUNDE, DOUALA), 6);
  });

  it('1° de latitude, 1° de longitude à l’équateur ≈ 111,195 km', () => {
    const oneDegree = (Math.PI / 180) * EARTH_RADIUS_METERS;
    expect(oneDegree).toBeCloseTo(111_194.93, 1);
    expect(
      haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }),
    ).toBeCloseTo(oneDegree, 3);
    expect(
      haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
    ).toBeCloseTo(oneDegree, 3);
  });

  it('antipodes : demi-circonférence (π × R)', () => {
    expect(
      haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 }),
    ).toBeCloseTo(Math.PI * EARTH_RADIUS_METERS, 3);
  });

  it('distances réelles : Paris–Londres ≈ 343,5 km, Douala–Yaoundé ≈ 194 km', () => {
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    const london = { latitude: 51.5074, longitude: -0.1278 };
    expect(Math.abs(haversineMeters(paris, london) - 343_500)).toBeLessThan(1_000);
    expect(Math.abs(haversineMeters(DOUALA, YAOUNDE) - 194_000)).toBeLessThan(2_000);
  });

  it('petites distances : 0,0001° de latitude ≈ 11,1 m', () => {
    expect(haversineMeters(DOUALA, north(11.1195))).toBeCloseTo(11.12, 1);
  });
});

describe('Précision limitée', () => {
  it('coordonnées arrondies à 4 décimales (≈ 11 m), distances au pas configuré', () => {
    expect(GEOLOCATION_CONFIG.storage.coordinateDecimals).toBe(4);
    expect(roundCoordinate(4.051234567, 4)).toBe(4.0512);
    expect(roundCoordinate(-9.76789, 4)).toBe(-9.7679);
    expect(roundDistance(847, GEOLOCATION_CONFIG.display.roundingMeters)).toBe(850);
  });
});

describe('TESTS 8 / 9 / 10 — paires et distances', () => {
  it('2 joueurs → 1 paire, 3 → 3, 4 → 6 ; jamais un joueur avec lui-même', () => {
    expect(playerPairs([A, B])).toEqual([[A, B]]);
    expect(playerPairs([A, B, C])).toEqual([
      [A, B],
      [A, C],
      [B, C],
    ]);
    expect(playerPairs([A, B, C, D])).toHaveLength(6);
    expect(playerPairs([A, A, B])).toEqual([[A, B]]);
  });

  const now = new Date(T0 + 60_000);
  const fresh = GEOLOCATION_CONFIG.display.freshnessMs;

  it('2 joueurs : une distance', () => {
    const result = pairDistances([A, B], [at(A, DOUALA, 50), at(B, north(500), 55)], now, fresh);
    expect(result).toHaveLength(1);
    expect(result[0]!.meters).toBeCloseTo(500, 0);
  });

  it('3 joueurs : trois distances, `null` pour le joueur sans position', () => {
    const result = pairDistances([A, B, C], [at(A, DOUALA, 50), at(B, north(100), 50)], now, fresh);
    expect(result.map((r) => [r.pair, r.meters === null ? null : Math.round(r.meters)])).toEqual([
      [[A, B], 100],
      [[A, C], null],
      [[B, C], null],
    ]);
  });

  it('4 joueurs : six distances ; position trop ancienne ou d’un autre joueur ignorée', () => {
    const result = pairDistances(
      [A, B, C, D],
      [
        at(A, DOUALA, 50),
        at(B, north(100), 50),
        at(C, north(300), 50),
        at(D, north(900), 60 - fresh / 1000 - 1), // trop ancienne
        at('intrus' as PlayerId, DOUALA, 50),
      ],
      now,
      fresh,
    );
    expect(result).toHaveLength(6);
    expect(result.filter((r) => r.meters !== null)).toHaveLength(3);
    expect(result.some((r) => r.pair.includes('intrus' as PlayerId))).toBe(false);
  });

  it('distance inconnue : WAITING sans position, STALE si une position est trop ancienne, jamais 0', () => {
    const stale = 60 - fresh / 1000 - 1;
    const result = pairDistances(
      [A, B, C],
      [at(A, DOUALA, 50), at(B, north(100), stale)],
      now,
      fresh,
    );
    expect(result.map((r) => [r.pair, r.meters, r.unavailable, r.missing])).toEqual([
      [[A, B], null, 'STALE', [B]],
      [[A, C], null, 'WAITING', [C]],
      [[B, C], null, 'WAITING', [B, C]],
    ]);
    const known = pairDistances([A, B], [at(A, DOUALA, 50), at(B, DOUALA, 50)], now, fresh);
    // Même lieu : 0 m est une vraie distance, distincte d'une distance inconnue.
    expect(known[0]).toMatchObject({ meters: 0, unavailable: null, missing: [] });
  });
});

describe('TEST 11 — PROXIMITY', () => {
  const near = (meters: number, seconds: number[]) =>
    seconds.flatMap((s) => [at(A, DOUALA, s), at(B, north(meters), s + 5)]);

  it('une seule mesure proche ne suffit jamais', () => {
    expect(findProximity(near(20, [0]), [A, B])).toBeNull();
  });

  it('mesures proches mais plus courtes que la durée minimale : aucun signal', () => {
    expect(DETECTION_THRESHOLDS.proximity.minDurationMs).toBe(60_000);
    expect(findProximity(near(20, [0, 30]), [A, B])).toBeNull();
  });

  it('proximité forte (< 50 m) sur la durée minimale', () => {
    expect(findProximity(near(20, [0, 45, 90]), [A, B])).toMatchObject({
      pair: [A, B],
      strength: 'strong',
      durationMs: 90_000,
      samples: 3,
    });
  });

  it('proximité significative (< 200 m) ; au-delà, rien', () => {
    expect(findProximity(near(120, [0, 45, 90]), [A, B])).toMatchObject({
      strength: 'significant',
    });
    expect(findProximity(near(250, [0, 45, 90]), [A, B])).toBeNull();
  });

  it('positions imprécises (> 100 m) ignorées : l’imprécision ne crée pas de proximité', () => {
    const imprecise = [0, 45, 90].flatMap((s) => [
      at(A, DOUALA, s, 150),
      at(B, north(20), s + 5, 150),
    ]);
    expect(findProximity(imprecise, [A, B])).toBeNull();
  });

  it('mesures non simultanées (> 60 s d’écart) jamais comparées', () => {
    const apart = [
      at(A, DOUALA, 0),
      at(A, DOUALA, 90),
      at(B, north(20), 200),
      at(B, north(20), 290),
    ];
    expect(findProximity(apart, [A, B])).toBeNull();
  });

  it('un épisode interrompu (trou > 2 min) ne s’additionne pas', () => {
    expect(findProximity(near(20, [0, 50, 300, 350]), [A, B])).toBeNull();
  });

  it('un joueur sans position (refus) : aucune proximité', () => {
    expect(
      findProximity(
        [0, 45, 90].map((s) => at(A, DOUALA, s)),
        [A, B],
      ),
    ).toBeNull();
  });
});

describe('TEST 13 — IMPOSSIBLE_TRAVEL', () => {
  it('Douala → Yaoundé en 60 s : vitesse > 900 km/h', () => {
    const found = findImpossibleTravel([at(A, DOUALA, 0), at(A, YAOUNDE, 60)], A);
    expect(found).toMatchObject({ playerId: A, occurrences: 1 });
    expect(found!.maxSpeedKmh).toBeGreaterThan(DETECTION_THRESHOLDS.travel.impossibleSpeedKmh);
  });

  it('Douala → Yaoundé en 4 h : plausible, aucun signal', () => {
    expect(findImpossibleTravel([at(A, DOUALA, 0), at(A, YAOUNDE, 4 * 3600)], A)).toBeNull();
  });

  it('les rayons d’incertitude sont retranchés : un saut dans la marge GPS n’est pas jugé', () => {
    // 1 150 m en 1 s, mais 100 m d'incertitude de chaque côté : 950 m < 1 000 m jugés.
    expect(
      findImpossibleTravel([at(A, DOUALA, 0, 100), at(A, north(1_150), 1, 100)], A),
    ).toBeNull();
  });

  it('positions imprécises ignorées ; positions d’un autre joueur ignorées', () => {
    expect(findImpossibleTravel([at(A, DOUALA, 0, 500), at(A, YAOUNDE, 60, 500)], A)).toBeNull();
    expect(findImpossibleTravel([at(A, DOUALA, 0), at(B, YAOUNDE, 60)], A)).toBeNull();
  });
});

describe('TEST 14 — INCOHERENT_LOCATION', () => {
  it('saut important suivi d’un retour au point de départ en quelques minutes', () => {
    const found = findIncoherentLocation(
      [at(A, DOUALA, 0), at(A, YAOUNDE, 60), at(A, north(30), 120)],
      A,
    );
    expect(found).toMatchObject({ playerId: A, occurrences: 1 });
    expect(found!.maxJumpMeters).toBeGreaterThan(190_000);
  });

  it('un vrai déplacement sans retour n’est pas une incohérence', () => {
    expect(
      findIncoherentLocation([at(A, DOUALA, 0), at(A, YAOUNDE, 60), at(A, YAOUNDE, 120)], A),
    ).toBeNull();
  });

  it('petits écarts GPS (jitter) jamais pris pour une incohérence', () => {
    expect(
      findIncoherentLocation(
        [at(A, DOUALA, 0, 80), at(A, north(400), 45, 80), at(A, DOUALA, 90, 80)],
        A,
      ),
    ).toBeNull();
  });

  it('aller-retour étalé sur plus de 10 minutes : aucun signal', () => {
    expect(
      findIncoherentLocation([at(A, DOUALA, 0), at(A, YAOUNDE, 300), at(A, DOUALA, 900)], A),
    ).toBeNull();
  });
});

describe('TESTS 5 / 6 — validation de la position reçue', () => {
  const valid = { latitude: 4.05, longitude: 9.76, accuracy: 15, capturedAt: T0 };

  it.each<[string, Record<string, unknown>, string]>([
    ['latitude > 90', { latitude: 91 }, 'latitude'],
    ['latitude < -90', { latitude: -90.5 }, 'latitude'],
    ['latitude texte', { latitude: '4.05' }, 'latitude'],
    ['longitude > 180', { longitude: 180.1 }, 'longitude'],
    ['longitude NaN', { longitude: Number.NaN }, 'longitude'],
    ['précision nulle', { accuracy: 0 }, 'accuracy'],
    ['précision déraisonnable', { accuracy: 5_000 }, 'accuracy'],
    ['date invalide', { capturedAt: 'hier' }, 'capturedAt'],
    ['gameId différent de l’URL', { gameId: '00000000-0000-4000-8000-000000000002' }, 'gameId'],
  ])('refusée : %s', (_label, overrides, field) => {
    try {
      parsePositionInput({ ...valid, ...overrides }, GAME);
      throw new Error('aurait dû être refusée');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(Object.keys((err as ValidationError).fields)).toEqual([field]);
    }
  });

  it('acceptée ; un playerId reçu est ignoré (identité = JWT)', () => {
    const input = parsePositionInput({ ...valid, playerId: 'autre', gameId: GAME }, GAME);
    expect(input).toEqual({
      latitude: 4.05,
      longitude: 9.76,
      accuracyMeters: 15,
      capturedAt: new Date(T0),
    });
    expect(input).not.toHaveProperty('playerId');
  });
});
