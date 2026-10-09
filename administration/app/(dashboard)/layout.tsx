import { Suspense, type ReactNode } from 'react';

import { LoadingRows } from '@/components/feedback/states';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';

/**
 * Coquille de l'administration. L'accès aux données est contrôlé par le backend à chaque
 * requête (rôle `admin`, session d'administration) ; cette mise en page ne fait qu'afficher.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="contenu" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Suspense fallback={<LoadingRows />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
