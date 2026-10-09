import {
  adminEvidenceOf,
  ALERT_PAGE,
  ALERT_STATUSES,
  ALERT_TRANSITIONS,
  canTransition,
  isAlertStatus,
} from '../../../src/domain/detection/alert-admin';
import { ValidationError } from '../../../src/validators/validation-error';
import {
  parseAlertId,
  parseAlertListQuery,
  parsePagination,
  parseStatusChange,
  parseSubjectKey,
} from '../../../src/validators/detection-admin.validators';

/** Administration de la détection (R-36, étape 5, D-049) : règles pures et validation. */

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function fieldsOf(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (err) {
    if (err instanceof ValidationError) return err.fields;
    throw err;
  }
  throw new Error('ValidationError attendue');
}

describe("Machine d'état des alertes", () => {
  it('statuts fermés : NEW, REVIEWED, DISMISSED, RESOLVED', () => {
    expect(ALERT_STATUSES).toEqual(['NEW', 'REVIEWED', 'DISMISSED', 'RESOLVED']);
    expect(isAlertStatus('REVIEWED')).toBe(true);
    expect(isAlertStatus('reviewed')).toBe(false);
    expect(isAlertStatus('BANNED')).toBe(false);
  });

  it('transitions autorisées : NEW → REVIEWED | DISMISSED, REVIEWED → RESOLVED', () => {
    const allowed = ALERT_STATUSES.flatMap((from) =>
      ALERT_STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}→${to}`),
    );
    expect(allowed.sort()).toEqual(['NEW→DISMISSED', 'NEW→REVIEWED', 'REVIEWED→RESOLVED']);
  });

  it('DISMISSED et RESOLVED sont finaux (aucune réouverture)', () => {
    expect(ALERT_TRANSITIONS.DISMISSED).toEqual([]);
    expect(ALERT_TRANSITIONS.RESOLVED).toEqual([]);
  });

  it('chaque statut cible a au plus une origine (une demande périmée ne passe jamais)', () => {
    for (const to of ALERT_STATUSES) {
      const origins = ALERT_STATUSES.filter((from) => canTransition(from, to));
      expect(origins.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('Éléments justificatifs minimisés', () => {
  it('retire coordonnées, IP, cartes, mains, jetons ; garde les données dérivées', () => {
    const evidence = {
      observations: 12,
      rate: 0.75,
      approxDistanceMeters: 40,
      periodDays: 30,
      latitude: 4.05,
      longitude: 9.7,
      accuracy: 12,
      ip: '10.0.0.1',
      cards: ['COEUR-7'],
      hand: ['PIQUE-3'],
      token: 'secret',
      nested: { lat: 1, lng: 2, peer: '192.168.1.1', card: 'TREFLE-9', games: 3 },
      samples: ['COEUR-10', 'ok', { password: 'x', count: 2 }],
    };
    expect(adminEvidenceOf(evidence)).toEqual({
      observations: 12,
      rate: 0.75,
      approxDistanceMeters: 40,
      periodDays: 30,
      nested: { peer: '[masqué]', games: 3 },
      samples: ['[masqué]', 'ok', { count: 2 }],
    });
  });

  it('profondeur bornée et types inattendus ignorés', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(adminEvidenceOf(deep)).toEqual({ a: { b: { c: { d: {} } } } });
    expect(adminEvidenceOf({ fn: () => 1, n: 1 })).toEqual({ n: 1 });
  });
});

describe('Validation des entrées', () => {
  it('liste : valeurs par défaut', () => {
    expect(parseAlertListQuery({})).toEqual({
      page: 1,
      limit: ALERT_PAGE.defaultLimit,
      sort: 'created_at_desc',
    });
  });

  it('liste : tous les filtres valides', () => {
    expect(
      parseAlertListQuery({
        page: '2',
        limit: '5',
        sort: 'score_desc',
        status: 'NEW',
        level: 'very_high',
        priority: 'PRIORITY',
        type: 'SUSPICION_LEVEL',
        subject: `${ID_A}|${ID_B}`,
        playerId: ID_A,
        from: '2026-10-01',
        to: '2026-10-08T12:00:00Z',
      }),
    ).toEqual({
      page: 2,
      limit: 5,
      sort: 'score_desc',
      status: 'NEW',
      level: 'very_high',
      priority: 'PRIORITY',
      type: 'SUSPICION_LEVEL',
      subjectKey: `${ID_A}|${ID_B}`,
      playerId: ID_A,
      from: new Date('2026-10-01'),
      to: new Date('2026-10-08T12:00:00Z'),
    });
  });

  it('liste : tri hors liste blanche, valeurs inconnues, paramètre inconnu ou répété → 400', () => {
    expect(fieldsOf(() => parseAlertListQuery({ sort: 'player_ids; DROP TABLE users' }))).toEqual({
      sort: 'Tri non autorisé.',
    });
    expect(
      Object.keys(
        fieldsOf(() =>
          parseAlertListQuery({
            status: 'BANNED',
            level: 'extreme',
            priority: 'URGENT',
            type: 'OTHER',
            playerId: 'not-a-uuid',
            subject: `${ID_B}|${ID_A}`,
            from: 'hier',
            limit: '1000',
            page: '0',
            evil: '1',
          }),
        ),
      ).sort(),
    ).toEqual(
      [
        'evil',
        'from',
        'level',
        'limit',
        'page',
        'playerId',
        'priority',
        'status',
        'subject',
        'type',
      ].sort(),
    );
    expect(fieldsOf(() => parseAlertListQuery({ status: ['NEW', 'REVIEWED'] }))).toHaveProperty(
      'status',
    );
    expect(
      fieldsOf(() => parseAlertListQuery({ from: '2026-10-08', to: '2026-10-01' })),
    ).toHaveProperty('to');
  });

  it('sujet canonique : 1 à 4 UUID triés, sans doublon', () => {
    expect(parseSubjectKey(`${ID_A}|${ID_B}`)).toBe(`${ID_A}|${ID_B}`);
    expect(parseSubjectKey(ID_A)).toBe(ID_A);
    for (const bad of [`${ID_B}|${ID_A}`, `${ID_A}|${ID_A}`, '', 'x', `${ID_A}|`]) {
      expect(() => parseSubjectKey(bad)).toThrow(ValidationError);
    }
  });

  it("identifiant d'alerte : UUID uniquement", () => {
    expect(parseAlertId(ID_A)).toBe(ID_A);
    expect(() => parseAlertId("1' OR '1'='1")).toThrow(ValidationError);
  });

  it('pagination seule (historique) : bornes et paramètres inconnus', () => {
    expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10 });
    expect(Object.keys(fieldsOf(() => parsePagination({ limit: '0', sort: 'x' })))).toEqual([
      'sort',
      'limit',
    ]);
  });

  it('changement de statut : statut strict, expectedStatus facultatif, aucun champ inconnu', () => {
    expect(parseStatusChange({ status: 'REVIEWED' })).toEqual({ status: 'REVIEWED' });
    expect(parseStatusChange({ status: 'RESOLVED', expectedStatus: 'REVIEWED' })).toEqual({
      status: 'RESOLVED',
      expectedStatus: 'REVIEWED',
    });
    expect(Object.keys(fieldsOf(() => parseStatusChange({ status: 'reviewed' })))).toEqual([
      'status',
    ]);
    expect(Object.keys(fieldsOf(() => parseStatusChange(null)))).toEqual(['status']);
    // L'administrateur vient de la session serveur : un adminId envoyé est refusé.
    expect(
      Object.keys(fieldsOf(() => parseStatusChange({ status: 'REVIEWED', adminId: ID_A }))),
    ).toEqual(['adminId']);
  });
});
