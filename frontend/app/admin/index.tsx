import { AdminScreen } from '../../src/features/admin/AdminScreen';

/** Administration (/admin) : réservée au rôle admin, sans lien depuis l'application joueur. */
export default function AdminRoute() {
  return <AdminScreen />;
}
