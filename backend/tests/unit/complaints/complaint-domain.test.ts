import {
  canTransition,
  COMPLAINT_REFERENCE_PATTERN,
  COMPLAINT_STATUSES,
  COMPLAINT_TRANSITIONS,
  initialPriority,
  newComplaintReference,
  sniffAttachmentType,
} from '../../../src/domain/complaints/complaint';

/** Réclamations (D-114) : workflow, références, priorités, signatures des pièces. */
describe('workflow des réclamations', () => {
  it('autorise le parcours nominal : analyse automatique puis examen, puis décision humaine', () => {
    expect(canTransition('OPEN', 'AI_ANALYSIS', 'SYSTEM')).toBe(true);
    expect(canTransition('AI_ANALYSIS', 'IN_REVIEW', 'SYSTEM')).toBe(true);
    expect(canTransition('IN_REVIEW', 'WAITING_FOR_PLAYER', 'ADMIN')).toBe(true);
    expect(canTransition('WAITING_FOR_PLAYER', 'IN_REVIEW', 'PLAYER')).toBe(true);
    expect(canTransition('IN_REVIEW', 'RESOLVED', 'ADMIN')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED', 'PLAYER')).toBe(true);
  });

  it('interdit au système (analyse automatique) de résoudre, rejeter ou clôturer un dossier', () => {
    for (const from of COMPLAINT_STATUSES) {
      for (const to of ['RESOLVED', 'REJECTED', 'CLOSED'] as const) {
        expect(canTransition(from, to, 'SYSTEM')).toBe(false);
      }
    }
  });

  it('interdit au joueur de se donner raison', () => {
    for (const from of COMPLAINT_STATUSES) {
      expect(canTransition(from, 'RESOLVED', 'PLAYER')).toBe(false);
      expect(canTransition(from, 'REJECTED', 'PLAYER')).toBe(false);
    }
  });

  it('refuse les transitions incohérentes et rend CLOSED définitif', () => {
    expect(canTransition('OPEN', 'RESOLVED', 'ADMIN')).toBe(false);
    expect(canTransition('WAITING_FOR_PLAYER', 'RESOLVED', 'ADMIN')).toBe(false);
    expect(Object.keys(COMPLAINT_TRANSITIONS.CLOSED)).toHaveLength(0);
    for (const to of COMPLAINT_STATUSES) expect(canTransition('CLOSED', to, 'ADMIN')).toBe(false);
  });

  it('priorise les catégories financières et la fraude', () => {
    expect(initialPriority('PAYMENT')).toBe('HIGH');
    expect(initialPriority('WITHDRAWAL')).toBe('HIGH');
    expect(initialPriority('TOURNAMENT_REWARD')).toBe('HIGH');
    expect(initialPriority('FRAUD')).toBe('HIGH');
    expect(initialPriority('TECHNICAL')).toBe('NORMAL');
    expect(initialPriority('OTHER')).toBe('LOW');
  });
});

describe('référence lisible', () => {
  it('suit le format RCL-AAAAMMJJ-XXXXXX', () => {
    const reference = newComplaintReference(new Date('2026-10-15T12:00:00Z'));
    expect(reference).toMatch(COMPLAINT_REFERENCE_PATTERN);
    expect(reference.startsWith('RCL-20261015-')).toBe(true);
  });

  it('est aléatoire (aucune séquence devinable)', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const references = new Set(Array.from({ length: 200 }, () => newComplaintReference(now)));
    expect(references.size).toBe(200);
  });
});

describe('type des pièces justificatives (signature du contenu)', () => {
  it('reconnaît JPEG, PNG, WebP et PDF', () => {
    expect(sniffAttachmentType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]))).toBe('image/jpeg');
    expect(
      sniffAttachmentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe('image/png');
    expect(sniffAttachmentType(new TextEncoder().encode('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffAttachmentType(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
  });

  it('refuse un exécutable, un script ou du HTML, quel que soit le nom annoncé', () => {
    expect(sniffAttachmentType(new TextEncoder().encode('MZ\x90\x00'))).toBeNull();
    expect(sniffAttachmentType(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    expect(sniffAttachmentType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });
});
