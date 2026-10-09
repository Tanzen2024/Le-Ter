/** Erreur renvoyée par l'API (backend ou passerelle) : code stable et message affichable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const SESSION_CODES = new Set([
  'ADMIN_SESSION_EXPIRED',
  'ADMIN_SESSION_REQUIRED',
  'UNAUTHENTICATED',
]);

/** Message compréhensible pour l'utilisateur, quel que soit l'incident. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Vous n'avez pas accès à cette ressource.";
    if (error.message) return error.message;
    if (error.status >= 500) return 'Le serveur rencontre un problème. Réessayez dans un instant.';
    return 'Une erreur est survenue.';
  }
  return 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.';
}
