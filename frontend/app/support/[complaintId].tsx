import { useLocalSearchParams } from 'expo-router';

import { ComplaintDetailScreen } from '../../src/features/complaints/ComplaintDetailScreen';

/** Détail d'une réclamation du joueur (D-114) ; le serveur refuse celles d'un autre joueur. */
export default function ComplaintDetailRoute() {
  const { complaintId } = useLocalSearchParams<{ complaintId: string }>();
  return <ComplaintDetailScreen complaintId={complaintId ?? ''} />;
}
