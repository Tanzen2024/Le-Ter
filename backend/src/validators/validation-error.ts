/** Entrée client invalide : un message par champ, affichable tel quel (validation inline). */
export class ValidationError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('Certaines informations sont invalides.');
    this.name = 'ValidationError';
  }
}
