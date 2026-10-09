'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LockKeyhole } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { InfoNote } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { sessionApi } from '@/lib/api/client';
import { ApiError, messageOf } from '@/lib/api/errors';
import { loginSchema, safeNextPath, type LoginValues } from '@/lib/validation/login';

const SESSION_MESSAGES: Record<string, string> = {
  expiree:
    'Votre session a expiré (30 minutes sans activité ou 8 heures au maximum). Reconnectez-vous.',
  requise: 'Connectez-vous pour accéder à l’administration.',
  deconnectee: 'Vous êtes déconnecté.',
};

export function LoginForm() {
  const params = useSearchParams();
  const notice = SESSION_MESSAGES[params.get('session') ?? ''];
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), mode: 'onSubmit' });

  async function onSubmit(values: LoginValues) {
    setError(null);
    try {
      await sessionApi.login(values.email, values.password);
      // Rechargement complet : les cookies de session tout juste posés sont pris en compte.
      window.location.replace(new URL(safeNextPath(params.get('suite')), window.location.origin));
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Trop de tentatives. Patientez quelques minutes avant de réessayer.');
      } else if (err instanceof ApiError && err.status === 401) {
        // Message identique pour un compte inconnu, un mauvais mot de passe ou un compte
        // sans droit d'administration : aucune information n'est divulguée.
        setError('Identifiants incorrects ou compte non autorisé.');
      } else {
        setError(messageOf(err));
      }
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-4">
      {notice && <InfoNote>{notice}</InfoNote>}
      <Field id="email" label="Adresse e-mail" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
        />
      </Field>
      <Field id="password" label="Mot de passe" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
        />
      </Field>
      {error && (
        <p role="alert" className="bg-danger-soft text-danger rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        <LockKeyhole /> {isSubmitting ? 'Connexion…' : 'Se connecter'}
      </Button>
      <p className="text-muted text-xs leading-relaxed">
        Session de 8 heures au maximum, fermée après 30 minutes sans activité. Les comptes
        d’administration sont attribués par l’exploitation, jamais par inscription.
      </p>
    </form>
  );
}
