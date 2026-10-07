/**
 * Ajoute l'heure du serveur à une vue envoyée au client (D-034). Le client s'en sert pour
 * aligner ses comptes à rebours (tour, décision) sur l'horloge du serveur ; il ne décide
 * jamais lui-même qu'une échéance est atteinte.
 */
export function withServerTime<T extends object>(view: T): T & { serverNow: Date } {
  return { ...view, serverNow: new Date() };
}
