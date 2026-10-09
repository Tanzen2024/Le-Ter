'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { api } from '@/lib/api/client';
import { ApiError, messageOf } from '@/lib/api/errors';
import {
  toTournamentPayload,
  tournamentFormSchema,
  type TournamentFormInput,
  type TournamentFormValues,
} from '@/lib/validation/tournament';
import type { TournamentSummary } from '@/types/admin';

/** Champs serveur → champs du formulaire, pour afficher les erreurs à leur place. */
const SERVER_FIELDS: Record<string, keyof TournamentFormInput> = {
  startsAt: 'date',
  endsAt: 'durationMinutes',
  entryFee: 'entryFee',
  minimumPlayers: 'minimumPlayers',
  maximumPlayers: 'maximumPlayers',
};

export function TournamentForm() {
  const router = useRouter();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState<TournamentFormValues | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TournamentFormInput, unknown, TournamentFormValues>({
    resolver: zodResolver(tournamentFormSchema),
    defaultValues: {
      date: '',
      time: '20:00',
      durationMinutes: '60',
      entryFee: '1000',
      minimumPlayers: '20',
      maximumPlayers: '',
      prizeRules: [{ percent: '50' }, { percent: '30' }, { percent: '20' }],
    },
  });
  const rules = useFieldArray({ control, name: 'prizeRules' });

  async function create(values: TournamentFormValues) {
    setFormError(null);
    try {
      const { tournament } = await api.post<{ tournament: TournamentSummary }>(
        'tournaments',
        toTournamentPayload(values),
      );
      toast.success('Tournoi créé et publié.');
      await client.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
      router.push(`/tournois/${tournament.tournamentId}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        for (const [key, message] of Object.entries(err.fields)) {
          const field = SERVER_FIELDS[key];
          if (field) setError(field, { message });
          else if (key === 'prizeRules') setError('prizeRules', { message });
        }
      }
      setFormError(messageOf(err));
      throw err;
    }
  }

  const ruleError = errors.prizeRules?.message ?? errors.prizeRules?.root?.message;

  return (
    <>
      <PageHeader
        title="Créer un tournoi"
        description="Le tournoi est publié directement. Les limites sont vérifiées par le serveur."
        actions={
          <Button variant="secondary" asChild>
            <Link href="/tournois">
              <ArrowLeft /> Tournois
            </Link>
          </Button>
        }
      />
      <form onSubmit={handleSubmit((v) => setConfirming(v))} noValidate className="space-y-6">
        <InfoNote>
          Règles appliquées par le serveur : durée de 30 à 120 minutes, 20 à 1 000 participants,
          aucun chevauchement avec un autre tournoi publié, commission et classement copiés depuis
          les paramètres à la publication. Heures exprimées dans le fuseau Africa/Douala.
        </InfoNote>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Calendrier" />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field id="date" label="Date" error={errors.date?.message}>
                <Input
                  id="date"
                  type="date"
                  aria-invalid={Boolean(errors.date)}
                  {...register('date')}
                />
              </Field>
              <Field id="time" label="Heure de début" error={errors.time?.message}>
                <Input
                  id="time"
                  type="time"
                  aria-invalid={Boolean(errors.time)}
                  {...register('time')}
                />
              </Field>
              <Field
                id="durationMinutes"
                label="Durée (minutes)"
                error={errors.durationMinutes?.message}
              >
                <Input
                  id="durationMinutes"
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.durationMinutes)}
                  {...register('durationMinutes')}
                />
              </Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Participation" />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field id="entryFee" label="Prix d’entrée (FCFA)" error={errors.entryFee?.message}>
                <Input
                  id="entryFee"
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.entryFee)}
                  {...register('entryFee')}
                />
              </Field>
              <Field id="minimumPlayers" label="Minimum" error={errors.minimumPlayers?.message}>
                <Input
                  id="minimumPlayers"
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.minimumPlayers)}
                  {...register('minimumPlayers')}
                />
              </Field>
              <Field
                id="maximumPlayers"
                label="Maximum"
                hint="Vide : sans maximum"
                error={errors.maximumPlayers?.message}
              >
                <Input
                  id="maximumPlayers"
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.maximumPlayers)}
                  {...register('maximumPlayers')}
                />
              </Field>
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader
            title="Répartition des gains"
            description="Pourcentage de la cagnotte des gains par rang ; le total doit faire 100 %."
          />
          <CardBody className="space-y-3">
            {rules.fields.map((f, i) => (
              <div key={f.id} className="flex items-end gap-3">
                <Field
                  id={`rule-${i}`}
                  label={`Rang ${i + 1} (%)`}
                  error={errors.prizeRules?.[i]?.percent?.message}
                  className="w-40"
                >
                  <Input
                    id={`rule-${i}`}
                    inputMode="decimal"
                    {...register(`prizeRules.${i}.percent` as const)}
                  />
                </Field>
                {rules.fields.length > 1 && i === rules.fields.length - 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => rules.remove(i)}
                    aria-label="Retirer ce rang"
                  >
                    <Minus />
                  </Button>
                )}
              </div>
            ))}
            {rules.fields.length < 10 && (
              <Button variant="secondary" size="sm" onClick={() => rules.append({ percent: '0' })}>
                <Plus /> Ajouter un rang
              </Button>
            )}
            {ruleError && (
              <p role="alert" className="text-danger text-xs">
                {ruleError}
              </p>
            )}
          </CardBody>
        </Card>
        {formError && (
          <p role="alert" className="bg-danger-soft text-danger rounded-md px-3 py-2 text-sm">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" asChild>
            <Link href="/tournois">Annuler</Link>
          </Button>
          <Button type="submit">Vérifier et publier</Button>
        </div>
      </form>
      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          title="Publier ce tournoi ?"
          description="Les joueurs pourront s’y inscrire selon son calendrier. L’opération est inscrite au journal d’audit."
          confirmLabel="Publier"
          onConfirm={() => create(confirming)}
        />
      )}
    </>
  );
}
