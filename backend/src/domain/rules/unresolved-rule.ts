/**
 * Levée quand le moteur atteint une situation que les documents ne définissent pas.
 * Le moteur refuse d'agir plutôt que de deviner. `ruleRef` renvoie à docs/TODO.md.
 */
export class UnresolvedRuleError extends Error {
  constructor(
    readonly ruleRef: string,
    message: string,
  ) {
    super(`Règle non définie (${ruleRef}) : ${message}`);
    this.name = 'UnresolvedRuleError';
  }
}
