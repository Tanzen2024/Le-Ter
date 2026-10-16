import { formatCoefficient, formatNumber } from '@/lib/format';

/**
 * Jetons de départ ou mise d'un tournoi, en LECTURE SEULE (D-071) : valeur calculée par le
 * serveur (prix d'entrée × coefficient des paramètres), jamais saisie ni recalculée ici.
 * Nombre seul, sans devise : ce sont des jetons de tournoi. `coefficient` n'est connu que tant
 * que la valeur suit les paramètres ; ensuite elle est figée : à la publication, ou dès la
 * première préinscription d'une proposition (`unpublished`, D-113).
 */
export function TokenSetupValue({
  value,
  coefficient,
  unpublished = false,
}: {
  value: number;
  coefficient?: number;
  unpublished?: boolean;
}) {
  return (
    <>
      <span className="tabular-nums">{formatNumber(value)}</span>
      <span className="text-muted block text-xs">
        {coefficient !== undefined
          ? `Prix d’entrée × ${formatCoefficient(coefficient)} (Paramètres) · figé à la première préinscription ou à l’approbation.`
          : unpublished
            ? 'Figé à la première préinscription.'
            : 'Figé à la publication.'}
      </span>
    </>
  );
}
