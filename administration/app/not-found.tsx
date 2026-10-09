import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main
      id="contenu"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <p className="text-accent text-sm font-medium">Erreur 404</p>
      <h1 className="text-ink text-2xl font-semibold">Page introuvable</h1>
      <p className="text-muted max-w-sm text-sm">Cette page n’existe pas ou a été déplacée.</p>
      <Button asChild className="mt-2">
        <Link href="/tableau-de-bord">Retour au tableau de bord</Link>
      </Button>
    </main>
  );
}
