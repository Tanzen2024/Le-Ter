import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { ApiError } from '../../lib/api-client';
import type { PaymentView } from '../../types/wallet';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { PanelButton } from '../lobby/LobbyUi';
import { openPaymentPage, usePayment } from './hooks';
import { paymentDisplay } from './payment-state';

/**
 * Suivi d'un paiement CinetPay (D-050) : « Paiement en cours... », « Paiement confirmé
 * +1 000 jetons », « Paiement échoué » ou « Paiement expiré », TOUJOURS d'après le statut lu
 * sur le serveur (GET /api/payments/:id), jamais d'après le retour de la page de paiement.
 */
export function PaymentProgress({
  paymentId,
  initial,
  doneLabel,
  onDone,
}: {
  paymentId: string;
  /** Paiement renvoyé à la création (affiché en attendant la première lecture). */
  initial?: PaymentView;
  doneLabel: string;
  onDone: () => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const query = usePayment(paymentId);
  const payment = query.data ?? initial;
  const small = [styles.small, { fontSize: m.smallSize }];

  if (!payment) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <View style={[styles.column, { gap: m.gap * 0.7 }]} testID="payment-progress">
        {query.error ? (
          <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.bodySize }]}>
            {notFound ? 'Paiement introuvable.' : query.error.message}
          </Text>
        ) : (
          <>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={small}>Chargement du paiement…</Text>
          </>
        )}
        {query.error ? <PanelButton title={doneLabel} onPress={onDone} /> : null}
      </View>
    );
  }

  const display = paymentDisplay(payment);
  const pending = payment.status === 'PENDING';
  return (
    <View
      style={[styles.column, { gap: m.gap * 0.7 }]}
      testID="payment-progress"
      accessibilityLiveRegion="polite"
    >
      {pending ? <ActivityIndicator color="#FFFFFF" /> : null}
      <Text
        accessibilityRole={display.tone === 'error' ? 'alert' : 'header'}
        style={[
          styles.title,
          display.tone === 'success' && styles.success,
          display.tone === 'error' && styles.error,
          fontOf(fonts.button),
          { fontSize: m.bodySize * 1.3 },
        ]}
      >
        {display.title}
      </Text>
      {display.detail ? (
        <Text
          style={[
            display.tone === 'success' ? styles.gain : styles.small,
            display.tone === 'success' && fontOf(fonts.title),
            { fontSize: display.tone === 'success' ? m.bodySize * 1.5 : m.smallSize },
          ]}
        >
          {display.detail}
        </Text>
      ) : null}
      {pending && payment.paymentUrl ? (
        <PanelButton
          title="Ouvrir la page de paiement"
          onPress={() => {
            void openPaymentPage(payment.paymentUrl!).finally(() => void query.refetch());
          }}
        />
      ) : null}
      {pending ? (
        <Text style={small}>Vous pouvez fermer : le solde sera mis à jour automatiquement.</Text>
      ) : null}
      <PanelButton title={doneLabel} tone={pending ? 'danger' : 'jade'} onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: 'center' },
  title: { color: '#FFFFFF', textAlign: 'center' },
  success: { color: '#F2C451' },
  error: { color: palette.error, textAlign: 'center', fontWeight: '600' },
  gain: { color: '#F2C451', textAlign: 'center' },
  small: { color: 'rgba(255, 255, 255, 0.78)', textAlign: 'center' },
});
