import { z } from 'zod';

/** Validation de FORMAT côté navigateur ; l'authentification est décidée par le backend. */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Saisissez votre adresse e-mail.')
    .max(254, 'Adresse e-mail trop longue.')
    .email('Adresse e-mail invalide.'),
  password: z.string().min(1, 'Saisissez votre mot de passe.').max(200, 'Mot de passe trop long.'),
});

export type LoginValues = z.infer<typeof loginSchema>;

/** Destination après connexion : chemin interne uniquement (pas de redirection ouverte). */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/tableau-de-bord';
  }
  if (value.startsWith('/api') || value.startsWith('/connexion')) return '/tableau-de-bord';
  return value;
}
