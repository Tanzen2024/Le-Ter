'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { TimePicker } from '@/components/ui/time-picker';
import { api } from '@/lib/api/client';
import { ApiError, messageOf } from '@/lib/api/errors';
import {
  GARAM_VARIANTS,
  toTournamentPayload,
  TOURNAMENT_GAMES,
  tournamentFormSchema,
  type TournamentFormInput,
  type TournamentFormValues,
} from '@/lib/validation/tournament';
import type { TournamentSummary } from '@/types/admin';

import { tournamentSettingsQuery } from './api';
import { creationRulesText } from './creation-rules';

/** Champs serveur → champs du formulaire, pour afficher les erreurs à leur place. */
const SERVER_FIELDS: Record<string, keyof TournamentFormInput> = {
  gameType: 'gameType',
  garamVariant: 'garamVariant',
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
    setValue,
    getFieldState,
    formState: { errors },
  } = useForm<TournamentFormInput, unknown, TournamentFormValues>({
    resolver: zodResolver(tournamentFormSchema),
    // Jeu du tournoi (D-124) : volontairement absent, aucune option cochée au chargement.
    defaultValues: {
      date: '',
      time: '20:00',
      durationMinutes: '60',
      // Variante GARAM TIA (D-127, amendement du 2026-10-21) : 15 présélectionnée, modifiable.
      garamVariant: '15',
      entryFee: '1000',
      minimumPlayers: '20',
      maximumPlayers: '',
      prizeRules: [{ percent: '50' }, { percent: '30' }, { percent: '20' }],
    },
  });
  const rules = useFieldArray({ control, name: 'prizeRules' });
  const gameType = useWatch({ control, name: 'gameType' });
  // Paramètres des tournois (D-103, D-104) : valeurs par défaut ajustées dès leur lecture,
  // sans toucher un champ déjà modifié ; le serveur reste juge des bornes.
  const settings = useQuery(tournamentSettingsQuery()).data?.settings;
  useEffect(() => {
    if (!settings) return;
    if (!getFieldState('minimumPlayers').isDirty) {
      setValue('minimumPlayers', String(settings.tournamentMinimumPlayers));
    }
    if (!getFieldState('durationMinutes').isDirty) {
      const duration = Math.min(
        settings.tournamentMaximumDurationMinutes,
        Math.max(settings.tournamentMinimumDurationMinutes, 60),
      );
      setValue('durationMinutes', String(duration));
    }
  }, [settings, getFieldState, setValue]);

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
          Règles appliquées par le serveur : {creationRulesText(settings)} (Paramètres des
          tournois), aucun chevauchement avec un autre tournoi publié, commission et classement
          copiés depuis les paramètres à la publication. Heures exprimées dans le fuseau
          Africa/Douala.
        </InfoNote>
        <Card>
          <CardHeader title="Jeu du tournoi *" />
          <CardBody>
            <fieldset aria-describedby={errors.gameType ? 'gameType-error' : undefined}>
              <legend className="sr-only">Jeu du tournoi</legend>
              <div className="flex flex-wrap gap-3">
                {TOURNAMENT_GAMES.map((game) => (
                  <label
                    key={game.value}
                    className="border-line-strong has-[:checked]:border-primary has-[:checked]:bg-primary-soft flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm font-semibold"
                  >
                    <input
                      type="radio"
                      value={game.value}
                      {...register('gameType')}
                    />
                    {game.label}
                  </label>
                ))}
              </div>
              {errors.gameType && (
                <p id="gameType-error" role="alert" className="text-danger mt-2 text-xs">
                  {errors.gameType.message}
                </p>
              )}
            </fieldset>
            {gameType === 'GARAM' && (
              // Variante GARAM TIA (D-127) : 15 présélectionnée, choix obligatoire.
              <fieldset
                className="mt-4"
                aria-describedby={errors.garamVariant ? 'garamVariant-error' : undefined}
              >
                <legend className="mb-2 text-sm font-semibold">Variante *</legend>
                <div className="flex flex-wrap gap-3">
                  {GARAM_VARIANTS.map((variant) => (
                    <label
                      key={variant}
                      className="border-line-strong has-[:checked]:border-primary has-[:checked]:bg-primary-soft flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm font-semibold"
                    >
                      <input type="radio" value={variant} {...register('garamVariant')} />
                      {`GARAM ${variant}`}
                    </label>
                  ))}
                </div>
                {errors.garamVariant && (
                  <p id="garamVariant-error" role="alert" className="text-danger mt-2 text-xs">
                    {errors.garamVariant.message}
                  </p>
                )}
              </fieldset>
            )}
          </CardBody>
        </Card>
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
                <Controller
                  control={control}
                  name="time"
                  render={({ field }) => (
                    <TimePicker
                      id="time"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-invalid={Boolean(errors.time)}
                      aria-describedby={errors.time ? 'time-error' : undefined}
                    />
                  )}
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
              <Field
                id="entryFee"
                label="Prix d’entrée (FCFA)"
                hint="Au moins 500 FCFA. Jetons de départ et mise calculés avec les coefficients des Paramètres."
                error={errors.entryFee?.message}
              >
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
