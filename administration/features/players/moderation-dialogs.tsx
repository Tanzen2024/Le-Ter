'use client';

import { useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api/errors';
import type { ModerationLimits } from '@/types/admin';

import type { RestrictionBody } from './api';

/** Bornes par défaut, identiques au backend (D-079) ; le serveur reste l'autorité. */
export const DEFAULT_LIMITS: ModerationLimits = {
  reason: { min: 3, max: 500 },
  comment: { max: 2000 },
  playerMessage: { max: 1000 },
  note: { max: 2000 },
  maxDurationDays: 365,
  minDurationMinutes: 5,
};

/** Saisie refusée avant l'envoi : message lisible sous le formulaire, rien n'est envoyé. */
function invalidForm(): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', 'Corrigez les champs indiqués.');
}

/** Erreurs de champ renvoyées par le serveur (400). */
export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError && err.fields ? err.fields : {};
}

function reasonError(reason: string, limits: ModerationLimits, required: boolean) {
  const length = reason.trim().length;
  if (length === 0) return required ? 'Motif obligatoire.' : undefined;
  if (length < limits.reason.min || length > limits.reason.max) {
    return `Entre ${limits.reason.min} et ${limits.reason.max} caractères.`;
  }
  return undefined;
}

/**
 * Confirmation d'une action avec motif (désactivation, levée, révocation…). Le motif est
 * enregistré dans le journal d'audit ; le serveur valide à nouveau.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  reasonRequired = true,
  reasonLabel = 'Motif',
  limits = DEFAULT_LIMITS,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  reasonRequired?: boolean;
  reasonLabel?: string;
  limits?: ModerationLimits;
  onConfirm: (reason: string) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setError(undefined);
        }
        onOpenChange(next);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      onConfirm={async () => {
        const invalid = reasonError(reason, limits, reasonRequired);
        setError(invalid);
        if (invalid) throw invalidForm();
        try {
          await onConfirm(reason.trim());
          setReason('');
        } catch (err) {
          setError(fieldErrors(err).reason);
          throw err;
        }
      }}
    >
      {children}
      <Field
        id="moderation-reason"
        label={reasonRequired ? reasonLabel : `${reasonLabel} (facultatif)`}
        error={error}
        hint="Enregistré dans le journal d’audit, jamais montré au joueur."
        className="mt-3"
      >
        <Textarea
          id="moderation-reason"
          value={reason}
          maxLength={limits.reason.max}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </Field>
    </ConfirmDialog>
  );
}

const DURATIONS = {
  '1h': { label: '1 heure', ms: 3_600_000 },
  '24h': { label: '24 heures', ms: 86_400_000 },
  '7d': { label: '7 jours', ms: 7 * 86_400_000 },
  '30d': { label: '30 jours', ms: 30 * 86_400_000 },
} as const;
type Duration = keyof typeof DURATIONS | 'custom' | 'indefinite';

/** Valeur `datetime-local` (heure du navigateur) → ISO 8601 ; undefined si invalide. */
function localToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Suspension ou restriction du chat : motif obligatoire, durée déterminée (préréglage ou date
 * de fin) ou indéterminée, commentaire interne facultatif. L'échéance est appliquée par le
 * serveur, à son heure ; aucun minuteur côté navigateur.
 */
export function RestrictionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  limits = DEFAULT_LIMITS,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  limits?: ModerationLimits;
  onConfirm: (body: RestrictionBody) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [duration, setDuration] = useState<Duration>('24h');
  const [until, setUntil] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset() {
    setReason('');
    setComment('');
    setDuration('24h');
    setUntil('');
    setErrors({});
  }

  function body(): RestrictionBody {
    const next: Record<string, string> = {};
    const invalid = reasonError(reason, limits, true);
    if (invalid) next.reason = invalid;
    let endsAt: string | undefined;
    if (duration === 'custom') {
      endsAt = localToIso(until);
      if (!endsAt) next.endsAt = 'Choisissez la date et l’heure de fin.';
      else if (new Date(endsAt).getTime() <= Date.now()) {
        next.endsAt = 'La fin doit être dans le futur.';
      }
    } else if (duration !== 'indefinite') {
      endsAt = new Date(Date.now() + DURATIONS[duration].ms).toISOString();
    }
    if (comment.trim().length > limits.comment.max) {
      next.comment = `${limits.comment.max} caractères au plus.`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) throw invalidForm();
    return {
      reason: reason.trim(),
      ...(comment.trim() && { comment: comment.trim() }),
      ...(endsAt && { endsAt }),
    };
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone="danger"
      onConfirm={async () => {
        const payload = body();
        try {
          await onConfirm(payload);
          reset();
        } catch (err) {
          setErrors(fieldErrors(err));
          throw err;
        }
      }}
    >
      <div className="space-y-3">
        <Field id="restriction-reason" label="Motif" error={errors.reason}>
          <Textarea
            id="restriction-reason"
            value={reason}
            maxLength={limits.reason.max}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field
          id="restriction-duration"
          label="Durée"
          hint={
            duration === 'indefinite'
              ? 'Sans échéance, mais toujours levable par un administrateur.'
              : `Fin calculée maintenant ; ${limits.maxDurationDays} jours au plus.`
          }
        >
          <Select
            id="restriction-duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value as Duration)}
          >
            {Object.entries(DURATIONS).map(([key, d]) => (
              <option key={key} value={key}>
                {d.label}
              </option>
            ))}
            <option value="custom">Jusqu’à une date précise</option>
            <option value="indefinite">Durée indéterminée</option>
          </Select>
        </Field>
        {duration === 'custom' && (
          <Field
            id="restriction-until"
            label="Fin (heure locale de votre navigateur)"
            error={errors.endsAt}
          >
            <Input
              id="restriction-until"
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
        )}
        {duration !== 'custom' && errors.endsAt && (
          <p role="alert" className="text-danger text-xs">
            {errors.endsAt}
          </p>
        )}
        <Field
          id="restriction-comment"
          label="Commentaire interne (facultatif)"
          error={errors.comment}
        >
          <Textarea
            id="restriction-comment"
            value={comment}
            maxLength={limits.comment.max}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

/**
 * Avertissement : motif interne obligatoire ; message visible facultatif, transmis par une
 * notification dans l'application du joueur ; commentaire interne facultatif.
 */
export function WarningDialog({
  open,
  onOpenChange,
  limits = DEFAULT_LIMITS,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limits?: ModerationLimits;
  onConfirm: (body: {
    reason: string;
    playerMessage?: string;
    comment?: string;
  }) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset() {
    setReason('');
    setMessage('');
    setComment('');
    setErrors({});
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Avertir le joueur"
      description="L’avertissement est enregistré dans le journal de modération. Un message visible n’est transmis que s’il est saisi."
      confirmLabel="Enregistrer l’avertissement"
      onConfirm={async () => {
        const invalid = reasonError(reason, limits, true);
        setErrors(invalid ? { reason: invalid } : {});
        if (invalid) throw invalidForm();
        try {
          await onConfirm({
            reason: reason.trim(),
            ...(message.trim() && { playerMessage: message.trim() }),
            ...(comment.trim() && { comment: comment.trim() }),
          });
          reset();
        } catch (err) {
          setErrors(fieldErrors(err));
          throw err;
        }
      }}
    >
      <div className="space-y-3">
        <Field id="warning-reason" label="Motif (interne)" error={errors.reason}>
          <Textarea
            id="warning-reason"
            value={reason}
            maxLength={limits.reason.max}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field
          id="warning-message"
          label="Message visible par le joueur (facultatif)"
          error={errors.playerMessage}
          hint="Affiché dans l’application du joueur (notification). Laissez vide pour un simple enregistrement."
        >
          <Textarea
            id="warning-message"
            value={message}
            maxLength={limits.playerMessage.max}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <Field id="warning-comment" label="Note interne (facultative)" error={errors.comment}>
          <Textarea
            id="warning-comment"
            value={comment}
            maxLength={limits.comment.max}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
