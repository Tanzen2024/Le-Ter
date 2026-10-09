import { z } from 'zod';

/**
 * Formulaire de création d'un tournoi : contrôle de FORMAT uniquement. Les règles (durée de
 * 30 à 120 min, 20 à 1 000 participants, chevauchement, 5 tournois en attente…) sont
 * appliquées par le serveur, qui renvoie un message par champ ; elles ne sont pas recopiées
 * ici pour ne jamais diverger.
 */
const int = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, message)
    .transform((v) => Number(v));

export const tournamentFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choisissez une date.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Choisissez une heure.'),
  durationMinutes: int('Durée en minutes entières.'),
  entryFee: int('Montant entier en FCFA.'),
  minimumPlayers: int('Nombre entier.'),
  maximumPlayers: z
    .string()
    .trim()
    .regex(/^\d*$/, 'Nombre entier, ou vide pour aucun maximum.')
    .transform((v) => (v === '' ? undefined : Number(v))),
  prizeRules: z
    .array(
      z.object({
        percent: z
          .string()
          .trim()
          .regex(/^\d+([.,]\d{1,2})?$/, 'Pourcentage.'),
      }),
    )
    .min(1, 'Au moins un rang payé.')
    .max(10, '10 rangs payés au plus.'),
});

export type TournamentFormInput = z.input<typeof tournamentFormSchema>;
export type TournamentFormValues = z.output<typeof tournamentFormSchema>;

/** Corps de POST /api/admin/tournaments ; l'heure saisie est celle d'Africa/Douala (UTC+1). */
export function toTournamentPayload(values: TournamentFormValues) {
  const startsAt = new Date(`${values.date}T${values.time}:00+01:00`);
  const endsAt = new Date(startsAt.getTime() + values.durationMinutes * 60_000);
  return {
    timezone: 'Africa/Douala',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    entryFee: values.entryFee,
    minimumPlayers: values.minimumPlayers,
    ...(values.maximumPlayers !== undefined && { maximumPlayers: values.maximumPlayers }),
    prizeRules: values.prizeRules.map((r, i) => ({
      rank: i + 1,
      percent: Number(r.percent.replace(',', '.')),
    })),
  };
}
