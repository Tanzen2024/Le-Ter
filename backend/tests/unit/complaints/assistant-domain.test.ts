import {
  guardReply,
  heuristicAnalysis,
  heuristicCategory,
  parseAnalysis,
  parseReply,
  toolsFor,
  verifiedValuesOf,
} from '../../../src/domain/complaints/assistant';

const GAME = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const OTHER = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b';

const valid = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    category: 'GAME_RESULT',
    confidence: 'high',
    references: {},
    tools: ['get_game'],
    needsHuman: false,
    playerWantsComplaint: false,
    ...overrides,
  });

describe('analyse générée : validation stricte', () => {
  it('accepte une analyse conforme et ne garde que les identifiants écrits par le joueur', () => {
    const result = parseAnalysis(
      valid({ references: { gameId: GAME } }),
      `ma partie ${GAME} est fausse`,
    );
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ category: 'GAME_RESULT', references: { gameId: GAME } }),
    });
  });

  it("refuse un identifiant que le joueur n'a jamais écrit (inventé par le modèle)", () => {
    const result = parseAnalysis(valid({ references: { gameId: OTHER } }), `ma partie ${GAME}`);
    expect(result).toEqual({ ok: false, reason: 'INVENTED_IDENTIFIER' });
  });

  it('refuse une catégorie inconnue, un JSON invalide ou des champs manquants', () => {
    expect(parseAnalysis(valid({ category: 'REFUND_NOW' }), '').ok).toBe(false);
    expect(parseAnalysis('pas du json', '').ok).toBe(false);
    expect(parseAnalysis(JSON.stringify({ category: 'OTHER' }), '').ok).toBe(false);
  });

  it("ignore les outils hors liste blanche (aucun outil d'écriture n'existe)", () => {
    const result = parseAnalysis(
      valid({ tools: ['get_game', 'credit_wallet', 'update_game_result', 'grant_reward'] }),
      '',
    );
    expect(result.ok && result.value.tools).toEqual(['get_game']);
  });

  it('borne la réponse générée', () => {
    expect(
      parseReply(JSON.stringify({ reply: 'x'.repeat(5000), suggestComplaint: false })).ok,
    ).toBe(false);
    expect(parseReply(JSON.stringify({ reply: '', suggestComplaint: false })).ok).toBe(false);
  });
});

describe('contrôle de la réponse générée (aucune donnée inventée)', () => {
  const facts = { payment: { paymentId: GAME, amount: 5000, tokens: 5000, status: 'PENDING' } };
  const verified = verifiedValuesOf(facts, '');

  it('accepte une réponse fondée sur les faits', () => {
    expect(
      guardReply('Votre recharge de 5000 FCFA est en attente de confirmation.', verified),
    ).toEqual({
      ok: true,
    });
  });

  it('refuse un montant ou un solde absent des faits', () => {
    expect(guardReply('Votre solde est de 12 500 jetons.', verified)).toEqual({
      ok: false,
      reason: 'UNVERIFIED_AMOUNT',
    });
  });

  it('refuse une transaction ou une référence inventée', () => {
    expect(guardReply(`La transaction ${OTHER} a été trouvée.`, verified).ok).toBe(false);
    expect(guardReply('Votre dossier RCL-20261015-ABCDEF est ouvert.', verified).ok).toBe(false);
  });

  it('refuse toute action prétendument exécutée (crédit, remboursement, correction)', () => {
    for (const text of [
      "J'ai crédité votre compte.",
      'Nous avons remboursé votre paiement.',
      "J'ai corrigé le résultat de la partie.",
      'I have credited your wallet.',
      "I've refunded you.",
    ]) {
      expect(guardReply(text, verified)).toEqual({ ok: false, reason: 'ACTION_CLAIM' });
    }
  });

  it('refuse un délai de résolution promis et une identité humaine revendiquée', () => {
    expect(guardReply('Ce sera réglé sous 48 heures.', verified)).toEqual({
      ok: false,
      reason: 'PROMISED_DELAY',
    });
    expect(guardReply('It will be fixed within 2 days.', verified).ok).toBe(false);
    expect(guardReply('Je suis un administrateur de Le Ter.', verified)).toEqual({
      ok: false,
      reason: 'HUMAN_CLAIM',
    });
  });
});

describe('classement de repli (sans modèle)', () => {
  it.each([
    ["J'ai gagné une partie mais mes jetons n'ont pas augmenté.", 'BALANCE'],
    ["Mon solde a diminué alors que je n'ai pas joué.", 'BALANCE'],
    ["Mon paiement MTN Money a été validé, mais mon compte n'a pas été crédité.", 'PAYMENT'],
    ["J'ai perdu ma connexion pendant une partie.", 'TECHNICAL'],
    ['Le résultat de ma partie est incorrect.', 'GAME_RESULT'],
    ["Je n'ai pas reçu ma récompense de tournoi.", 'TOURNAMENT_REWARD'],
    ['Je souhaite signaler un comportement suspect.', 'FRAUD'],
    ['My withdrawal never arrived', 'WITHDRAWAL'],
    ['Bonjour', 'OTHER'],
  ])('« %s » → %s', (text, category) => {
    expect(heuristicCategory(text)).toBe(category);
  });

  it('rattache un identifiant écrit à la catégorie et choisit les outils de lecture', () => {
    const analysis = heuristicAnalysis(
      `partie ${GAME} résultat faux`,
      `partie ${GAME} résultat faux`,
    );
    expect(analysis.references.gameId).toBe(GAME);
    expect(toolsFor(analysis)).toEqual(['get_game']);
    expect(toolsFor(heuristicAnalysis('recharge MTN', 'recharge MTN'))).toEqual(['check_payment']);
  });

  it('détecte une demande explicite de réclamation et un besoin humain', () => {
    expect(
      heuristicAnalysis('je veux déposer une réclamation', 'je veux déposer une réclamation')
        .playerWantsComplaint,
    ).toBe(true);
    expect(heuristicAnalysis('il triche', 'il triche').needsHuman).toBe(true);
  });
});

describe('garde renforcée : décisions, remboursements, crédits, contradictions, dates', () => {
  const values = (findings: string[] = []) => ({
    ...verifiedValuesOf({ amount: 5000 }, ''),
    findings: new Set(findings),
  });

  it.each([
    'Votre réclamation a été acceptée.',
    'Your claim has been approved.',
    'Le support a décidé de vous donner raison.',
    'An admin has approved your request.',
  ])('refuse une décision humaine prétendument connue : « %s »', (text) => {
    expect(guardReply(text, values())).toEqual({ ok: false, reason: 'DECISION_CLAIM' });
  });

  it.each([
    'Votre recharge a été remboursée.',
    'Le remboursement a été effectué.',
    'Votre solde a été corrigé.',
    'Your payment has been refunded.',
    'The refund has been processed.',
  ])('refuse un remboursement ou une correction affirmés : « %s »', (text) => {
    expect(guardReply(text, values(['PAYMENT_CREDITED']))).toEqual({
      ok: false,
      reason: 'UNVERIFIED_CORRECTION',
    });
  });

  it("n'admet un crédit affirmé que si le serveur a constaté un crédit réel", () => {
    const text = 'Vos jetons ont été crédités sur votre compte.';
    expect(guardReply(text, values(['PAYMENT_PENDING']))).toEqual({
      ok: false,
      reason: 'UNVERIFIED_CREDIT',
    });
    expect(guardReply(text, values())).toEqual({ ok: false, reason: 'UNVERIFIED_CREDIT' });
    expect(guardReply(text, values(['PAYMENT_CREDITED']))).toEqual({ ok: true });
  });

  it('refuse une affirmation contraire aux constats du serveur', () => {
    expect(guardReply('Votre paiement est confirmé.', values(['PAYMENT_PENDING']))).toEqual({
      ok: false,
      reason: 'CONTRADICTS_FACTS',
    });
    expect(guardReply('Bravo, vous avez gagné !', values(['GAME_LOST'])).ok).toBe(false);
    expect(guardReply('Votre retrait a été effectué.', values(['WITHDRAWAL_FAILED'])).ok).toBe(
      false,
    );
    // Une formulation exacte reste admise.
    expect(
      guardReply(
        'Votre recharge attend la confirmation de l’opérateur.',
        values(['PAYMENT_PENDING']),
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    'Ce sera réglé demain.',
    'Le support vous répondra avant le 20 octobre.',
    'Ce sera fait dans quelques jours.',
    'It will be fixed by tomorrow.',
    'Expect an answer within a few days.',
  ])('refuse une date ou un délai promis : « %s »', (text) => {
    expect(guardReply(text, values())).toEqual({ ok: false, reason: 'PROMISED_DELAY' });
  });

  it('le résumé pour le support peut rapporter une DÉCLARATION du joueur', () => {
    const text = 'Le joueur déclare que sa recharge a été remboursée puis débitée à nouveau.';
    expect(guardReply(text, values(), { declarations: true })).toEqual({ ok: true });
    expect(guardReply(text, values()).ok).toBe(false);
    // Les actions, délais et identités restent interdits même dans un résumé.
    expect(guardReply("J'ai crédité le joueur.", values(), { declarations: true }).ok).toBe(false);
  });
});

describe('minimisation des outils', () => {
  it("n'exécute pas un outil demandé par le modèle sans rapport avec la catégorie", () => {
    const tools = toolsFor({
      category: 'TOURNAMENT_REWARD',
      confidence: 'high',
      references: {},
      tools: ['get_wallet_history', 'check_payment', 'get_tournament_status'],
      needsHuman: false,
      playerWantsComplaint: false,
    });
    expect(tools).toEqual(['get_tournament_status']);
  });
});
