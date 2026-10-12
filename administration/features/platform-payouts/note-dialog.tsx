'use client';

import { useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Field, Textarea } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api/errors';

/**
 * Refus métier du serveur (403 « autre administrateur », 409…) : son message, fixe et sans
 * donnée sensible, est affiché tel quel (le 403 générique le masquerait).
 */
export function readableError(error: unknown): unknown {
  if (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === 'PLATFORM_PAYOUT_REFUSED'
  ) {
    return new ApiError(409, error.code, error.message);
  }
  return error;
}

/** Confirmation avec note (obligatoire ou facultative), validée aussi par le serveur. */
export function NoteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone,
  required,
  noteLabel,
  minLength = 5,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  required: boolean;
  noteLabel: string;
  minLength?: number;
  onConfirm: (note: string | undefined) => Promise<unknown>;
}) {
  const [note, setNote] = useState('');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote('');
        onOpenChange(next);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      onConfirm={async () => {
        const trimmed = note.trim();
        if (required && trimmed.length < minLength) {
          throw new ApiError(400, 'VALIDATION', `${noteLabel} : ${minLength} caractères minimum.`);
        }
        try {
          await onConfirm(trimmed || undefined);
        } catch (err) {
          throw readableError(err);
        }
      }}
    >
      <Field
        id="decision-note"
        label={`${noteLabel}${required ? '' : ' (facultatif)'}`}
        hint="Aucun numéro de téléphone."
      >
        <Textarea
          id="decision-note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}
