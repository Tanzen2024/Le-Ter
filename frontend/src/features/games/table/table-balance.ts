import { useState } from 'react';

import { useBalanceLabel } from '../../lobby/LobbyUi';

export type BalanceLabel = ReturnType<typeof useBalanceLabel>;

const sameLabel = (a: BalanceLabel, b: BalanceLabel) =>
  a.text === b.text && a.label === b.label && a.reserved === b.reserved;

/**
 * Le serveur règle la partie dès son résultat officiel, c'est-à-dire dès la fin du 4e tour (5e
 * tour automatique, D-035), alors que l'écran présente encore les dernières cartes (D-041)
 * avant d'annoncer le gagnant et le bilan. Pendant cette présentation, le solde affiché à la
 * table reste celui d'AVANT la fin : le nouveau solde n'apparaît qu'avec le résultat, jamais
 * avant (D-080). Le solde affiché reste toujours une valeur lue sur le serveur.
 *
 * `frozen` : partie terminée côté serveur, résultat pas encore annoncé à l'écran.
 */
export function useTableBalanceLabel(frozen: boolean): BalanceLabel {
  const live = useBalanceLabel();
  const [shown, setShown] = useState(live);
  // Valeur dérivée (motif React « état précédent ») : suivie tant que rien n'est figé.
  if (!frozen && !sameLabel(shown, live)) setShown(live);
  return frozenBalance(frozen, shown, live);
}

/** Pure : la valeur gardée pendant le gel, sauf si aucun solde n'était encore connu. */
export function frozenBalance(
  frozen: boolean,
  shown: BalanceLabel,
  live: BalanceLabel,
  unavailableText = '—',
): BalanceLabel {
  return frozen && shown.text !== unavailableText ? shown : live;
}
