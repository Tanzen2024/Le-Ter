import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LogoMark } from '@/components/layout/logo';
import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Connexion' };

export default function LoginPage() {
  return (
    <main id="contenu" className="flex min-h-dvh">
      <section className="bg-primary text-primary-ink relative hidden w-[44%] flex-col justify-between overflow-hidden p-10 lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark className="size-9" />
          <p className="text-sm font-semibold">Le Ter · Administration</p>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            Superviser les parties, les tournois et les finances de Le Ter.
          </h1>
          <p className="text-primary-ink/70 mt-4 text-sm leading-relaxed">
            Les données affichées proviennent directement du serveur de jeu. Chaque accès et chaque
            action sensible sont vérifiés par le serveur et inscrits au journal d’audit.
          </p>
        </div>
        <p className="text-primary-ink/50 text-xs">Accès réservé au super administrateur.</p>
        <div
          aria-hidden
          className="border-accent/15 pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full border-[40px]"
        />
      </section>
      <section className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark />
            <p className="text-ink text-sm font-semibold">Le Ter · Administration</p>
          </div>
          <h2 className="text-ink text-xl font-semibold tracking-tight">Connexion</h2>
          <p className="text-muted mt-1 text-sm">Utilisez votre compte administrateur dédié.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
