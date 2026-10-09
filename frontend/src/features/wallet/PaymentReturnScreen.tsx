import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { tablePalette as palette } from '../../components/table/TableDecor';
import { useAuthStore } from '../../stores/auth-store';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { LobbyPanel, PanelButton } from '../lobby/LobbyUi';
import { LobbyShell } from '../lobby/LobbyShell';
import { PaymentProgress } from './PaymentProgress';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Retour de la page de paiement CinetPay : `leter://payment/return?paymentId=…` (D-050).
 * Ce lien ne prouve rien : l'écran relit le paiement sur le serveur (GET /api/payments/:id)
 * et n'affiche que le statut réel.
 *
 * Route hors garde d'authentification (ouverte à froid par le lien) : pendant la restauration
 * de la session, l'écran attend ; sans session, il renvoie vers la connexion.
 */
export function PaymentReturnScreen() {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') {
    return (
      <View style={styles.loading} testID="payment-return-loading">
        <ActivityIndicator color={palette.gold} size="large" />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/login" />;
  return <SignedInPaymentReturn />;
}

function SignedInPaymentReturn() {
  const m = useLobbyMetrics();
  const { paymentId } = useLocalSearchParams<{ paymentId?: string }>();
  const id = typeof paymentId === 'string' && UUID.test(paymentId) ? paymentId : undefined;
  const home = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <LobbyShell onBack={home}>
      <LobbyPanel title="Paiement" onClose={home} width={Math.max(420, m.width * 0.5)}>
        <View style={[styles.body, { padding: m.gap }]}>
          {id ? (
            <PaymentProgress paymentId={id} doneLabel="Retour à l’accueil" onDone={home} />
          ) : (
            <View style={{ gap: m.gap, alignItems: 'center' }}>
              <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.bodySize }]}>
                Paiement introuvable.
              </Text>
              <PanelButton title="Retour à l’accueil" onPress={home} />
            </View>
          )}
        </View>
      </LobbyPanel>
    </LobbyShell>
  );
}

const styles = StyleSheet.create({
  // Même écran d'attente que l'accueil (app/index.tsx).
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.backdrop,
  },
  body: { alignItems: 'center', justifyContent: 'center' },
  error: { color: palette.error, textAlign: 'center', fontWeight: '600' },
});
