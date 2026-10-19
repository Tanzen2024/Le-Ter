import { useCallback, useState } from 'react';

/**
 * État de « Tirer pour actualiser » : l'indicateur ne s'affiche QUE pour un geste du joueur.
 *
 * Lier `refreshing` à `isRefetching` l'affichait aussi pour les relectures automatiques
 * (arrivée sur l'écran, retour au premier plan, signal temps réel) : la liste descendait pour
 * laisser place à l'indicateur puis remontait, et l'écran semblait trembler à chaque arrivée.
 * Ces relectures restent silencieuses ; les données se mettent à jour sur place.
 */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const done = () => setRefreshing(false);
    void refetch().then(done, done);
  }, [refetch]);
  return { refreshing, onRefresh };
}
