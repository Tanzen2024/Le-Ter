import type { Metadata } from 'next';

import { AuditLogView } from '@/features/audit/audit-log-view';

export const metadata: Metadata = { title: 'Journal d’audit' };

export default function Page() {
  return <AuditLogView />;
}
