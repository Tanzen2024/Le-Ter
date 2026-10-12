'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Infinity as InfinityIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState, LoadingRows } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import type { WithdrawalLimitSetting } from '@/types/admin';

import { setWithdrawalLimit, withdrawalLimitQuery } from './api';

type Unit = 'hours' | 'days';
const MINUTES: Record<Unit, number> = { hours: 60, days: 1440 };

interface FormState {
  countUnlimited: boolean;
  count: string;
  periodUnlimited: boolean;
  period: string;
  unit: Unit;
}

function toForm(s: WithdrawalLimitSetting): FormState {
  const minutes = s.periodMinutes;
  const unit: Unit = minutes !== null && minutes % 1440 === 0 ? 'days' : 'hours';
  return {
    countUnlimited: s.count === null,
    count: s.count === null ? '' : String(s.count),
    periodUnlimited: minutes === null,
    period: minutes === null ? '' : String(minutes / MINUTES[unit]),
    unit,
  };
}

/** Durée lisible : « 24 heures », « 7 jours », « 90 minutes ». */
export function formatPeriodMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} jour${minutes / 1440 > 1 ? 's' : ''}`;
  if (minutes % 60 === 0) return `${minutes / 60} heure${minutes / 60 > 1 ? 's' : ''}`;
  return `${minutes} minute${minutes > 1 ? 's' : ''}`;
}

/** Phrase décrivant le quota enregistré ; `null` = illimité (∞). */
export function describeWithdrawalLimit(limit: {
  count: number | null;
  periodMinutes: number | null;
}): string {
  if (limit.count === null) return 'Retraits illimités (aucune limite de fréquence).';
  const n = `${limit.count} retrait${limit.count > 1 ? 's' : ''}`;
  return limit.periodMinutes === null
    ? `Au plus ${n} par joueur, au total (période illimitée).`
    : `Au plus ${n} par joueur sur toute période glissante de ${formatPeriodMinutes(limit.periodMinutes)}.`;
}

/**
 * Valide la saisie. Renvoie le quota à enregistrer (`null` = ∞) ou les erreurs par champ.
 * Le serveur revalide toujours (entiers, bornes) : ce contrôle n'évite qu'un aller-retour.
 */
export function parseLimitForm(
  form: FormState,
  bounds: WithdrawalLimitSetting['bounds'],
): {
  limit?: { count: number | null; periodMinutes: number | null };
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  let count: number | null = null;
  if (!form.countUnlimited) {
    const n = /^\d+$/.test(form.count.trim()) ? Number(form.count.trim()) : NaN;
    if (!Number.isSafeInteger(n) || n < 1 || n > bounds.maxCount) {
      errors.count = `Entier entre 1 et ${bounds.maxCount}.`;
    } else count = n;
  }
  let periodMinutes: number | null = null;
  if (!form.periodUnlimited) {
    const v = /^\d+$/.test(form.period.trim()) ? Number(form.period.trim()) : NaN;
    const minutes = v * MINUTES[form.unit];
    if (!Number.isSafeInteger(v) || v < 1 || minutes > bounds.maxPeriodMinutes) {
      errors.period = `Entier positif, au plus ${formatPeriodMinutes(bounds.maxPeriodMinutes)}.`;
    } else periodMinutes = minutes;
  }
  return Object.keys(errors).length > 0 ? { errors } : { limit: { count, periodMinutes }, errors };
}

/**
 * Quota de retraits (D-075) : `withdrawal_limit_count` et `withdrawal_limit_period`. Les deux
 * valeurs par défaut sont ∞ (aucune limite). Toute modification est validée par le serveur et
 * auditée.
 */
export function WithdrawalLimitCard() {
  const client = useQueryClient();
  const query = useQuery(withdrawalLimitQuery());
  const [pending, setPending] = useState<{ count: number | null; periodMinutes: number | null }>();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const setting = query.data;

  async function save(limit: { count: number | null; periodMinutes: number | null }) {
    try {
      const result = await setWithdrawalLimit(limit);
      toast.success(
        result.changed ? 'Quota de retraits enregistré et audité.' : 'Quota déjà à jour.',
      );
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setServerErrors({
          ...(err.fields.count && { count: err.fields.count }),
          ...(err.fields.periodMinutes && { period: err.fields.periodMinutes }),
        });
      }
      throw err;
    }
    await client.invalidateQueries({ queryKey: ['admin', 'withdrawal-limit'] });
  }

  return (
    <Card id="retraits">
      <CardHeader
        title="Limitation des retraits"
        description="Nombre maximal de retraits Mobile Money par joueur sur une période glissante. Par défaut : illimité (∞)."
      />
      <CardBody>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !setting ? (
          <LoadingRows rows={3} />
        ) : (
          // Nouvelle valeur enregistrée : formulaire réinitialisé depuis le serveur.
          <LimitForm
            key={`${setting.count}-${setting.periodMinutes}-${setting.updatedAt}`}
            setting={setting}
            serverErrors={serverErrors}
            onEdit={() => setServerErrors({})}
            onSubmit={setPending}
          />
        )}
      </CardBody>
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(undefined)}
          title="Enregistrer le quota de retraits ?"
          description="Le nouveau quota s’applique immédiatement aux prochaines demandes de retrait. La modification est inscrite au journal d’audit."
          confirmLabel="Enregistrer"
          onConfirm={() => save(pending)}
        >
          <p className="text-ink text-sm">{describeWithdrawalLimit(pending)}</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function LimitForm({
  setting,
  serverErrors,
  onEdit,
  onSubmit,
}: {
  setting: WithdrawalLimitSetting;
  serverErrors: Record<string, string>;
  onEdit: () => void;
  onSubmit: (limit: { count: number | null; periodMinutes: number | null }) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(setting));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const errors = { ...serverErrors, ...localErrors };
  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setLocalErrors({});
    onEdit();
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = parseLimitForm(form, setting.bounds);
        setLocalErrors(parsed.errors);
        if (parsed.limit) onSubmit(parsed.limit);
      }}
    >
      <div className="bg-surface-muted flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
        <InfinityIcon className="text-faint mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="text-ink font-medium">{describeWithdrawalLimit(setting)}</p>
          <p className="text-muted text-xs">
            Dernière modification : {formatDateTime(setting.updatedAt)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          id="withdrawal-count"
          label="Nombre maximal de retraits (n)"
          hint="Illimité = aucune limite de fréquence, quelle que soit la période."
          error={errors.count}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-ink flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.countUnlimited}
                onChange={(e) => update({ countUnlimited: e.target.checked })}
              />
              Illimité (∞)
            </label>
            <Input
              id="withdrawal-count"
              inputMode="numeric"
              className="w-28"
              disabled={form.countUnlimited}
              value={form.count}
              aria-invalid={Boolean(errors.count)}
              onChange={(e) => update({ count: e.target.value })}
            />
          </div>
        </Field>
        <Field
          id="withdrawal-period"
          label="Période (t)"
          hint="Illimitée avec n fini = au plus n retraits au total."
          error={errors.period}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-ink flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.periodUnlimited}
                onChange={(e) => update({ periodUnlimited: e.target.checked })}
              />
              Illimitée (∞)
            </label>
            <Input
              id="withdrawal-period"
              inputMode="numeric"
              className="w-24"
              disabled={form.periodUnlimited}
              value={form.period}
              aria-invalid={Boolean(errors.period)}
              onChange={(e) => update({ period: e.target.value })}
            />
            <Select
              aria-label="Unité de la période"
              className="w-auto"
              disabled={form.periodUnlimited}
              value={form.unit}
              onChange={(e) => update({ unit: e.target.value as Unit })}
            >
              <option value="hours">heures</option>
              <option value="days">jours</option>
            </Select>
          </div>
        </Field>
      </div>
      <p className="text-muted text-xs">
        Comptent : les retraits enregistrés non échoués (en attente, en traitement, confirmés), pour
        qu’aucune demande simultanée ne dépasse le quota. Ne comptent pas : les demandes refusées
        avant création et les retraits échoués (jetons remboursés).
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => update(toForm(setting))}>
          Annuler
        </Button>
        <Button type="submit">Enregistrer</Button>
      </div>
    </form>
  );
}
