import { useLocalSearchParams } from 'expo-router';

import { LegalDocumentScreen } from '../../src/features/legal/LegalDocumentScreen';

/** Réglages → Conditions d'utilisation (/legal/terms) ou Confidentialité (/legal/privacy). */
export default function LegalDocumentRoute() {
  const { document } = useLocalSearchParams<{ document: string }>();
  return <LegalDocumentScreen documentId={document ?? ''} />;
}
