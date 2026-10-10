import { formatCoefficient, formatNumber } from '@/lib/format';

/**
 * Jetons de départ ou mise d'un tournoi, en LECTURE SEULE (D-071) : valeur calculée par le
 * serveur (prix d'entrée × coefficient des paramètres), jamais saisie ni recalculée ici.
 * Nombre seul, sans devise : ce sont des jetons de tournoi. `coefficient` n'est connu qu'avant
 * la publication ; ensuite la valeur est figée.
 */
export function TokenSetupValue({ value, coefficient }: { value: number; coefficient?: number }) {
  return (
    <>
      <span className="tabular-nums">{formatNumber(value)}</span>
      <span className="text-muted block text-xs">
        {coefficient === undefined
          ? 'Figé à la publication.'
          : `Prix d’entrée × ${formatCoefficient(coefficient)} (Paramètres) · figé à l’approbation.`}
      </span>
    </>
  );
}
