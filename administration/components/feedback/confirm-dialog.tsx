'use client';

import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ApiError, messageOf } from '@/lib/api/errors';

/** Messages par champ d'un refus de validation, sans doublon. */
const fieldMessages = (error: unknown): string[] =>
  error instanceof ApiError && error.fields ? [...new Set(Object.values(error.fields))] : [];

/**
 * Confirmation explicite d'une action sensible. L'action n'est envoyée qu'après un clic
 * sur le bouton de confirmation ; l'erreur éventuelle du serveur reste affichée.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<unknown>;
  children?: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setError(null);
          onOpenChange(next);
        }
      }}
    >
      <DialogContent title={title} description={description}>
        {children}
        {error !== null && (
          <div role="alert" className="bg-danger-soft text-danger mt-3 rounded-md px-3 py-2 text-sm">
            <p>{messageOf(error)}</p>
            {/* Refus de validation : le serveur dit précisément ce qui bloque (ex. délai). */}
            {fieldMessages(error).length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {fieldMessages(error).map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button variant={tone} onClick={confirm} disabled={pending}>
            {pending ? 'En cours…' : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
