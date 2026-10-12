import type { RestrictionKind } from '../domain/admin/moderation';

/**
 * Condition SQL « le compte `userColumn` a une mesure `kind` ACTIVE à l'heure `nowParam` »
 * (D-079) : non levée, et sans échéance ou échéance future. L'heure est celle du serveur,
 * passée en paramètre ; l'expiration ne demande ni minuteur ni écriture. Servie par
 * l'index partiel `user_sanctions_open_idx`.
 *
 * `kind` provient d'une liste fermée (type), jamais d'une saisie.
 */
export function activeSanctionSql(userColumn: string, kind: RestrictionKind, nowParam: string) {
  return `EXISTS (SELECT 1 FROM user_sanctions s
    WHERE s.user_id = ${userColumn} AND s.kind = '${kind}' AND s.lifted_at IS NULL
      AND (s.ends_at IS NULL OR s.ends_at > ${nowParam}))`;
}
