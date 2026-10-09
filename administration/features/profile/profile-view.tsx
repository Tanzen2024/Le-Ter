'use client';

import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';

import { DetailList } from '@/components/data/data-table';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useAdminSession, useLogout } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/format';

export function ProfileView() {
  const query = useAdminSession();
  const logout = useLogout();
  const data = query.data;
  if (query.error)
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  if (!data) return <LoadingRows rows={6} />;
  const { user, session } = data;
  return (
    <>
      <PageHeader
        title="Profil et session"
        description="Compte connecté et état de la session d’administration, contrôlée par le serveur."
        actions={
          <Button variant="danger" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut /> {logout.isPending ? 'Déconnexion…' : 'Se déconnecter'}
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Identité"
            actions={
              <Badge tone="primary">
                <ShieldCheck className="size-3" aria-hidden /> SUPER_ADMIN
              </Badge>
            }
          />
          <CardBody>
            <DetailList
              items={[
                ['Nom', `${user.firstName} ${user.lastName}`],
                ['Pseudo', user.username],
                ['E-mail', user.email],
                ['Rôle', 'Super administrateur (rôle technique « admin »)'],
                ['Compte créé le', formatDateTime(user.createdAt)],
                [
                  'Identifiant',
                  <span key="i" className="font-mono text-xs">
                    {user.id}
                  </span>,
                ],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Session en cours"
            actions={<KeyRound className="text-faint size-4" aria-hidden />}
          />
          <CardBody>
            <DetailList
              items={[
                ['Ouverte le', formatDateTime(session.startedAt)],
                ['Fin au plus tard', formatDateTime(session.expiresAt)],
                ['Dernière activité', formatDateTime(session.lastActivityAt)],
                ['Expire sans activité à', formatDateTime(session.idleExpiresAt)],
                ['Durée maximale', `${session.absoluteLifetimeSeconds / 3600} heures`],
                ['Inactivité tolérée', `${session.idleTimeoutSeconds / 60} minutes`],
              ]}
            />
          </CardBody>
        </Card>
      </div>
      <InfoNote className="mt-6">
        Les jetons de session restent sur le serveur (cookies inaccessibles au navigateur). Une
        connexion avec ce compte depuis l’application mobile ferme cette session (une seule session
        active par compte). La création d’un autre administrateur se fait uniquement sur le serveur,
        par l’outil d’exploitation.
      </InfoNote>
    </>
  );
}
