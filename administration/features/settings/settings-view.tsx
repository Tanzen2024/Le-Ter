'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Server, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { DetailList } from '@/components/data/data-table';
import { StatusBadge } from '@/components/data/status-badge';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState, InfoNote, LoadingRows, UnavailableNotice } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { detectionSettingQuery, setDetection } from '@/features/anti-collusion/api';
import { GameCommissionCard } from '@/features/settings/game-commission-card';
import { tournamentSettingsQuery } from '@/features/tournaments/api';
import { WithdrawalLimitCard } from '@/features/withdrawals/withdrawal-limit-card';
import { WithdrawalServiceStatus } from '@/features/withdrawals/withdrawal-service-status';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { SERVICE_STATUS } from '@/lib/labels';
import type { SystemInfo, TournamentSettings } from '@/types/admin';

const number = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d+)?$/, 'Nombre attendu.');
const settingsSchema = z.object({
  platformFeePercent: number,
  initialTokensCoefficient: number,
  stakePerGameCoefficient: number,
  maximumPendingTournamentsPerPlayer: number,
  tournamentTransitionMinutes: number,
  rankingTokensWeightPercent: number,
  rankingGamesWeightPercent: number,
  tournamentMinimumPlayers: z.string().trim().regex(/^\d+$/, 'Nombre entier attendu.'),
  tournamentMinimumDurationMinutes: z.string().trim().regex(/^\d+$/, 'Nombre entier attendu.'),
  tournamentMaximumDurationMinutes: z.string().trim().regex(/^\d+$/, 'Nombre entier attendu.'),
  tournamentMinimumEntryFee: z.string().trim().regex(/^\d+$/, 'Montant entier attendu (FCFA).'),
  // Vide = aucun plafond (∞).
  tournamentMaximumPlayers: z
    .string()
    .trim()
    .regex(/^\d*$/, 'Nombre entier attendu, ou vide pour illimité.'),
}).superRefine((values, ctx) => {
  // Poids du classement (D-062, D-106) : chacun de 0 à 100 et somme EXACTEMENT 100 %. Le
  // serveur reste juge ; ce contrôle évite seulement un aller-retour.
  const tokens = Number(values.rankingTokensWeightPercent.replace(',', '.'));
  const games = Number(values.rankingGamesWeightPercent.replace(',', '.'));
  if (!Number.isFinite(tokens) || !Number.isFinite(games)) return;
  for (const [key, value] of [
    ['rankingTokensWeightPercent', tokens],
    ['rankingGamesWeightPercent', games],
  ] as const) {
    if (value < 0 || value > 100) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Entre 0 et 100 %.' });
    }
  }
  if (tokens + games !== 100) {
    for (const key of ['rankingTokensWeightPercent', 'rankingGamesWeightPercent'] as const) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'La somme des poids doit être exactement 100 %.',
      });
    }
  }
});
type SettingsForm = z.infer<typeof settingsSchema>;

type SettingField = {
  key: keyof SettingsForm;
  label: string;
  hint: string;
  placeholder?: string;
};

/** Champs regroupés par type, groupes et champs classés par priorité. */
const SETTING_GROUPS: { title: string; fields: SettingField[] }[] = [
  {
    title: 'Participants',
    fields: [
      {
        key: 'tournamentMinimumPlayers',
        label: 'Nombre minimum de joueurs',
        hint: 'Plus petit minimum de participants accepté à la création d’un tournoi. Par défaut : 20.',
      },
      {
        key: 'tournamentMaximumPlayers',
        label: 'Nombre maximum de joueurs',
        hint: 'Plus grand maximum de participants accepté à la création d’un tournoi. Laisser vide : illimité (∞, par défaut).',
        placeholder: '∞',
      },
      {
        key: 'maximumPendingTournamentsPerPlayer',
        label: 'Propositions en attente par joueur',
        hint: 'Limite des propositions de tournoi.',
      },
    ],
  },
  {
    title: 'Durée et calendrier',
    fields: [
      {
        key: 'tournamentMinimumDurationMinutes',
        label: 'Durée minimale d’un tournoi (minutes)',
        hint: 'Plus courte durée acceptée à la création d’un tournoi. Par défaut : 45 minutes.',
      },
      {
        key: 'tournamentMaximumDurationMinutes',
        label: 'Durée maximale d’un tournoi (minutes)',
        hint: 'Plus longue durée acceptée à la création d’un tournoi. Par défaut : 120 minutes.',
      },
      {
        key: 'tournamentTransitionMinutes',
        label: 'Transition entre tournois (min)',
        hint: 'Délai bloqué après la fin d’un tournoi.',
      },
    ],
  },
  {
    title: 'Finances',
    fields: [
      {
        key: 'tournamentMinimumEntryFee',
        label: 'Prix d’entrée minimal (FCFA)',
        hint: 'Plus petit prix d’entrée accepté à la création d’un tournoi. Par défaut : 500 FCFA.',
      },
      {
        key: 'platformFeePercent',
        label: 'Commission de la plateforme (%)',
        hint: 'Commission de la plateforme appliquée selon les règles financières du tournoi.',
      },
      {
        key: 'initialTokensCoefficient',
        label: 'Coefficient de jetons de tournoi au départ',
        hint: 'Multiplié par le prix d’entrée pour calculer les jetons de départ des prochains tournois publiés.',
      },
      {
        key: 'stakePerGameCoefficient',
        label: 'Coefficient de mise par partie de tournoi',
        hint: 'Multiplié par le prix d’entrée pour calculer la mise par partie des prochains tournois publiés.',
      },
    ],
  },
  {
    title: 'Classement',
    fields: [
      {
        key: 'rankingTokensWeightPercent',
        label: 'Poids des jetons restants (%)',
        hint: 'Le total des deux poids doit être égal à 100 %.',
      },
      {
        key: 'rankingGamesWeightPercent',
        label: 'Poids des parties jouées (%)',
        hint: 'Le total des deux poids doit être égal à 100 %.',
      },
    ],
  },
];

const SETTING_FIELDS: SettingField[] = SETTING_GROUPS.flatMap((g) => g.fields);

/** Valeur affichée d'un paramètre ; maximum de joueurs `null` = illimité. */
const shown = (v: number | null) => (v === null ? '∞ (illimité)' : String(v));

/** Décimales affichées avec la virgule (« 0,5 ») ; la saisie accepte la virgule ou le point. */
function toForm(s: TournamentSettings): SettingsForm {
  return Object.fromEntries(
    Object.entries(s).map(([k, v]) => [k, v === null ? '' : String(v).replace('.', ',')]),
  ) as SettingsForm;
}

function TournamentSettingsCard() {
  const client = useQueryClient();
  const query = useQuery(tournamentSettingsQuery());
  const [pending, setPending] = useState<Partial<TournamentSettings> | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
  });
  useEffect(() => {
    if (query.data) reset(toForm(query.data.settings));
  }, [query.data, reset]);

  async function save(patch: Partial<TournamentSettings>) {
    try {
      await api.patch('tournaments/settings', patch);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        for (const [k, m] of Object.entries(err.fields))
          setError(k as keyof SettingsForm, { message: m });
      }
      throw err;
    }
    toast.success('Paramètres enregistrés et audités.');
    await client.invalidateQueries({ queryKey: ['admin', 'tournament-settings'] });
  }

  return (
    <Card>
      <CardHeader
        title="Paramètres des tournois"
        description="Paramètres réellement pris en charge par le serveur. Ils ne modifient jamais un tournoi déjà publié."
      />
      <CardBody>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !query.data ? (
          <LoadingRows rows={4} />
        ) : (
          <form
            noValidate
            onSubmit={handleSubmit((values) => {
              const patch = Object.fromEntries(
                Object.keys(dirtyFields).map((k) => {
                  const raw = values[k as keyof SettingsForm];
                  // Maximum de joueurs laissé vide : aucun plafond (∞).
                  if (k === 'tournamentMaximumPlayers' && raw === '') return [k, null];
                  return [k, Number(raw.replace(',', '.'))];
                }),
              ) as Partial<TournamentSettings>;
              setPending(patch);
            })}
            className="space-y-4"
          >
            {SETTING_GROUPS.map((g) => (
              <fieldset key={g.title} className="space-y-3">
                <legend className="text-ink text-sm font-semibold">{g.title}</legend>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {g.fields.map((f) => (
                    <Field
                      key={f.key}
                      id={f.key}
                      label={f.label}
                      hint={f.hint}
                      error={errors[f.key]?.message}
                    >
                      <Input
                        id={f.key}
                        inputMode="decimal"
                        placeholder={f.placeholder}
                        aria-invalid={Boolean(errors[f.key])}
                        {...register(f.key)}
                      />
                    </Field>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={!isDirty}
                onClick={() => reset(toForm(query.data.settings))}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={!isDirty}>
                Enregistrer
              </Button>
            </div>
          </form>
        )}
      </CardBody>
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title="Enregistrer ces paramètres ?"
          description="Les nouvelles valeurs s’appliqueront aux prochains tournois publiés. La modification est inscrite au journal d’audit."
          confirmLabel="Enregistrer"
          onConfirm={() => save(pending)}
        >
          <ul className="space-y-1 text-sm">
            {Object.entries(pending).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="text-ink-soft">
                  {SETTING_FIELDS.find((f) => f.key === k)?.label ?? k}
                </span>
                <span className="text-ink font-medium">{shown(v)}</span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function DetectionCard() {
  const client = useQueryClient();
  const query = useQuery(detectionSettingQuery());
  const [confirm, setConfirm] = useState(false);
  const enabled = query.data?.enabled;
  return (
    <Card id="detection">
      <CardHeader
        title="Détection anti-collusion"
        description="Interrupteur global : la détection d’une table exige aussi son option à la création."
      />
      <CardBody>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : enabled === undefined ? (
          <LoadingRows rows={2} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {enabled ? (
                <ShieldCheck className="text-success size-5" aria-hidden />
              ) : (
                <ShieldOff className="text-faint size-5" aria-hidden />
              )}
              <div>
                <p className="text-ink text-sm font-medium">
                  {enabled ? 'Détection activée' : 'Détection désactivée'}
                </p>
                <p className="text-muted text-xs">
                  Dernière modification : {formatDateTime(query.data?.updatedAt)}
                </p>
              </div>
            </div>
            <Button variant={enabled ? 'secondary' : 'primary'} onClick={() => setConfirm(true)}>
              {enabled ? 'Désactiver' : 'Activer'}
            </Button>
          </div>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={enabled ? 'Désactiver la détection ?' : 'Activer la détection ?'}
        description={
          enabled
            ? 'Plus aucun signal ne sera collecté ni analysé sur aucune table. Les alertes existantes sont conservées. L’opération est auditée.'
            : 'Les tables créées avec l’option de détection seront analysées. Aucune sanction automatique. L’opération est auditée.'
        }
        confirmLabel={enabled ? 'Désactiver' : 'Activer'}
        tone={enabled ? 'danger' : 'primary'}
        onConfirm={async () => {
          const result = await setDetection(!enabled);
          toast.success(result.changed ? 'Paramètre modifié et audité.' : 'Paramètre déjà à jour.');
          await client.invalidateQueries({ queryKey: ['admin', 'detection-setting'] });
        }}
      />
    </Card>
  );
}

function SystemCard() {
  const query = useQuery({
    queryKey: ['admin', 'system'],
    queryFn: () => api.get<SystemInfo>('system'),
  });
  const s = query.data;
  return (
    <Card>
      <CardHeader
        title="État des services"
        description="Informations techniques non sensibles."
        actions={<Server className="text-faint size-4" aria-hidden />}
      />
      <CardBody>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !s ? (
          <LoadingRows rows={3} />
        ) : (
          <DetailList
            items={[
              [
                'Base de données (PostgreSQL)',
                <StatusBadge key="db" map={SERVICE_STATUS} value={s.services.database} />,
              ],
              [
                'Temps réel (Redis)',
                <StatusBadge key="r" map={SERVICE_STATUS} value={s.services.redis} />,
              ],
              [
                'Paiements CinetPay',
                s.services.cinetpay.configured ? (
                  <Badge
                    key="c"
                    tone={s.services.cinetpay.mode === 'production' ? 'success' : 'warning'}
                    dot
                  >
                    Configuré ·{' '}
                    {s.services.cinetpay.mode === 'production' ? 'production' : 'bac à sable'}
                  </Badge>
                ) : (
                  <Badge key="c" dot>
                    Non configuré
                  </Badge>
                ),
              ],
              [
                'Retraits Mobile Money',
                <WithdrawalServiceStatus key="w" state={s.services.withdrawals} />,
              ],
              ['Environnement', s.environment],
              ['Heure du serveur', formatDateTime(s.serverTime)],
              ['Fuseau d’affichage', s.timezone],
              [
                'Session d’administration',
                `${s.sessionPolicy.absoluteLifetimeSeconds / 3600} h au maximum, ${s.sessionPolicy.idleTimeoutSeconds / 60} min d’inactivité`,
              ],
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}

export function SettingsView() {
  return (
    <>
      <PageHeader
        title="Paramètres"
        description="Seuls les paramètres réellement pris en charge par le serveur sont modifiables. Toute modification est validée par le serveur et auditée."
      />
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SystemCard />
          <DetectionCard />
        </div>
        <GameCommissionCard />
        <TournamentSettingsCard />
        <WithdrawalLimitCard />
        <Card>
          <CardHeader title="Autres paramètres" />
          <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <UnavailableNotice title="Paramètres du jeu">
              Les règles du jeu (minuteur, distribution, combinaisons) sont fixées par le serveur et
              ne sont pas modifiables depuis l’administration.
            </UnavailableNotice>
            <UnavailableNotice title="Mode maintenance">
              Aucun mode maintenance n’existe dans le backend.
            </UnavailableNotice>
            <UnavailableNotice title="Identifiants CinetPay">
              Les secrets ne sont jamais affichés ni modifiables depuis le navigateur : ils sont
              configurés sur le serveur.
            </UnavailableNotice>
            <UnavailableNotice title="Comptes administrateurs">
              Le rôle d’administration est attribué par l’outil d’exploitation du serveur, jamais
              depuis cette interface.
            </UnavailableNotice>
          </CardBody>
        </Card>
        <InfoNote>
          Modifier un paramètre ne perturbe jamais un tournoi en cours ni une partie : les tournois
          publiés conservent les valeurs copiées à leur publication, et chaque partie garde le taux
          de commission figé à son démarrage.
        </InfoNote>
      </div>
    </>
  );
}
