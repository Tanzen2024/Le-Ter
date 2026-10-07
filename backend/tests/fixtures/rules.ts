import { OFFICIAL_TER_RULES } from '../../src/domain/rules/official-rules';
import type { TerRuleSet } from '../../src/domain/rules/rule-set';

/**
 * Règles des tests = règles OFFICIELLES (D-035, socle de vérité). Les tests qui vérifient
 * un mécanisme indépendamment d'une règle la remplacent explicitement (`withRules`).
 */
export const testRules: TerRuleSet = OFFICIAL_TER_RULES;

export function withRules(overrides: Partial<TerRuleSet>): TerRuleSet {
  return { ...testRules, ...overrides };
}
