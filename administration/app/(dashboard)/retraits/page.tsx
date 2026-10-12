import type { Metadata } from 'next';

import { WithdrawalsList } from '@/features/withdrawals/withdrawals-list';

export const metadata: Metadata = { title: 'Retraits' };

export default function Page() {
  return <WithdrawalsList />;
}
