import { Wallet, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { ApiError } from '../../lib/api-client';
import type { DirectPayOperator, PaymentView, WalletTransactionView } from '../../types/wallet';
import { useBackToClose } from '../games/table/GameOverlays';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { openPaymentPage, useWallet, useWalletOperation } from './hooks';
import {
  checkDepositAmount,
  DEFAULT_DEPOSIT_LIMITS,
  DIRECT_PAY_OPERATOR_LABELS,
  formatFcfa,
} from './payment-state';
import { PaymentProgress } from './PaymentProgress';

/**
 * Identité du moyen de paiement. Le projet ne contient AUCUN logo officiel MTN ou Orange Money :
 * pastille textuelle aux couleurs de l'opérateur, en attendant des ressources officielles
 * autorisées. Texte foncé sur jaune MTN et sur orange : contraste ≥ 7:1.
 */
const OPERATORS: Record<
  DirectPayOperator,
  { badge: string; background: string; glow: string; badgeText: string }
> = {
  MTN_CM: {
    badge: 'MTN',
    background: '#FFCB05',
    glow: 'rgba(255, 203, 5, 0.35)',
    badgeText: '#FFCB05',
  },
  OM_CM: {
    badge: 'OM',
    background: '#FF7900',
    glow: 'rgba(255, 121, 0, 0.35)',
    badgeText: '#FF7900',
  },
};

/** Charte Le-Ter, en version douce : vert profond, or et bordeaux en accents. */
const COLORS = {
  backdrop: 'rgba(3, 12, 8, 0.55)',
  cardTop: '#163C2B',
  cardBottom: '#0E271C',
  cardBorder: 'rgba(242, 196, 81, 0.18)',
  gold: '#F2C451',
  goldSoft: 'rgba(242, 196, 81, 0.14)',
  bordeaux: '#8C2F3D',
  bordeauxSoft: 'rgba(140, 47, 61, 0.22)',
  surface: 'rgba(255, 255, 255, 0.055)',
  surfaceBorder: 'rgba(255, 255, 255, 0.10)',
  text: '#F6F2E8',
  muted: 'rgba(246, 242, 232, 0.62)',
  ink: '#151515',
  info: 'rgba(242, 196, 81, 0.12)',
} as const;

type Notice = { tone: 'error' | 'pending'; text: string };

/**
 * Message court et distinct selon la cause (D-091). « Aucun montant n'a été débité » n'est
 * affirmé QUE pour un refus certain du fournisseur ; une issue inconnue est annoncée comme une
 * vérification en cours, sans inviter à relancer.
 */
function noticeOf(error: unknown): Notice {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return { tone: 'error', text: 'Impossible de contacter le service de paiement. Réessayez.' };
    }
    if (error.fields.tokens) return { tone: 'error', text: error.fields.tokens };
    switch (error.code) {
      case 'PAYMENT_VERIFICATION_PENDING':
        return {
          tone: 'pending',
          text: 'Vérification du paiement en cours. Ne relancez pas tout de suite : votre solde sera mis à jour automatiquement si le paiement aboutit.',
        };
      case 'SERVICE_TEMPORARILY_UNAVAILABLE':
        return {
          tone: 'error',
          text: 'Service momentanément indisponible. Réessayez dans quelques instants.',
        };
      case 'MOBILE_MONEY_UNAVAILABLE':
        return {
          tone: 'error',
          text: 'Service de paiement momentanément indisponible. Aucun montant n’a été débité.',
        };
      case 'PAYMENT_OPERATOR_UNSUPPORTED':
        return { tone: 'error', text: error.message };
      default:
        return { tone: 'error', text: `Paiement refusé. ${error.message}` };
    }
  }
  return { tone: 'error', text: 'Paiement impossible. Réessayez.' };
}

/**
 * Recharger mon portefeuille (D-085, D-087, D-090, D-091) : le joueur saisit SEULEMENT le
 * montant. Le moyen de paiement est déduit par le serveur du numéro d'inscription
 * (`paymentOperator`) : un seul bouton, à ses couleurs. L'application n'envoie que le montant ;
 * le serveur choisit le paiement direct puis, sur un refus certain, la page CinetPay (jamais deux
 * paiements). Aucun crédit affiché avant le statut relu sur le serveur (`PaymentProgress`).
 */
export function DepositSheet({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (transaction: WalletTransactionView) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const wallet = useWallet();
  const operation = useWalletOperation('deposit');
  const [input, setInput] = useState('');
  const [payment, setPayment] = useState<PaymentView>();
  const [notice, setNotice] = useState<Notice>();
  useBackToClose(onClose);

  const limits = wallet.data?.depositLimits ?? DEFAULT_DEPOSIT_LIMITS;
  // Opérateur décidé par le serveur ; `null` : numéro non pris en charge ; absent : chargement.
  const operator = wallet.data?.paymentOperator;
  const unavailable = wallet.data !== undefined && !wallet.data.mobileMoneyAvailable;
  const check = checkDepositAmount(input, limits);
  const processing = operation.isPending;
  // Vérification en cours : pas de nouvelle demande tant que le joueur n'a pas changé le montant.
  const verifying = notice?.tone === 'pending';

  // Une seule colonne centrée, compacte, quelle que soit l'orientation.
  const width = Math.min(460, m.width - m.safe.left - m.safe.right - 32);
  const maxHeight = m.height - m.safe.top - m.safe.bottom - 16;
  const field = Math.max(52, Math.round(m.controlHeight * 1.15));
  const title = Math.round(m.bodySize * 1.1);
  const small = { fontSize: m.smallSize };

  /** Une Idempotency-Key par intention ; montant revalidé, moyen choisi par le serveur. */
  const pay = () => {
    if (processing || unavailable || verifying || !operator || !check.ok) return;
    setNotice(undefined);
    operation.reset();
    operation.mutate(
      { tokens: check.amount, key: operation.newKey() },
      {
        onSuccess: (result) => {
          if (!result.payment) {
            onDone(result.transaction);
            return;
          }
          setPayment(result.payment);
          if (result.payment.paymentUrl) void openPaymentPage(result.payment.paymentUrl);
        },
        onError: (err) => setNotice(noticeOf(err)),
      },
    );
  };

  // Page générique (opérateur non présélectionné par le serveur) : le dire, sans rien garantir.
  const pageHint =
    payment && payment.mode !== 'DIRECT' && operator && payment.operator !== operator
      ? `Sur la page CinetPay, choisissez ${DIRECT_PAY_OPERATOR_LABELS[operator]}.`
      : undefined;

  const amountBlock = (
    <View style={styles.block}>
      <Text nativeID="deposit-amount-label" style={[styles.label, styles.centered, small]}>
        Montant de la recharge (FCFA)
      </Text>
      <View
        style={[
          styles.field,
          { height: field },
          !check.ok && check.reason !== 'empty' && styles.fieldError,
        ]}
      >
        <TextInput
          value={input}
          onChangeText={(value) => {
            if (processing) return;
            operation.reset();
            setNotice(undefined);
            setInput(value);
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={9}
          editable={!processing && !unavailable && operator !== null}
          placeholder="0"
          placeholderTextColor="rgba(246, 242, 232, 0.28)"
          accessibilityLabel="Montant de la recharge (FCFA)"
          accessibilityLabelledBy="deposit-amount-label"
          returnKeyType="done"
          onSubmitEditing={pay}
          style={[styles.input, fontOf(fonts.button), { fontSize: m.bodySize * 1.45 }]}
        />
        <Text style={[styles.suffix, fontOf(fonts.button), { fontSize: m.bodySize }]}>FCFA</Text>
      </View>
      {/* Limites non affichées : seul un montant refusé est signalé. */}
      {!check.ok && check.message ? (
        <Text accessibilityRole="alert" style={[styles.errorText, styles.centered, small]}>
          {check.message}
        </Text>
      ) : null}
    </View>
  );

  const payBlock = (
    <View style={styles.block}>
      {operator ? (
        <PayButton
          operator={operator}
          height={Math.max(54, field)}
          fontFamily={fonts.button}
          textSize={m.bodySize}
          disabled={unavailable || processing || verifying || !check.ok}
          loading={processing}
          amount={check.ok ? check.amount : undefined}
          onPress={pay}
        />
      ) : operator === null ? (
        <View style={[styles.chip, styles.chipWarning]}>
          <Text accessibilityRole="alert" style={[styles.chipText, small]}>
            Le numéro de votre compte n’est pas un numéro MTN Mobile Money ou Orange Money du
            Cameroun : aucun paiement n’est possible. Contactez l’assistance pour faire vérifier ou
            mettre à jour votre numéro.
          </Text>
        </View>
      ) : (
        <ActivityIndicator color={COLORS.gold} />
      )}
    </View>
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.center}
      >
        <View
          accessibilityViewIsModal
          testID="deposit-sheet"
          style={[styles.card, { width, maxHeight }]}
        >
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Wallet size={Math.round(title * 1.05)} color={COLORS.gold} strokeWidth={1.8} />
            </View>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.title, fontOf(fonts.button), { fontSize: title }]}
            >
              Recharger mon portefeuille
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              hitSlop={10}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <X size={Math.round(title * 0.95)} color={COLORS.muted} strokeWidth={2} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {payment ? (
              <View style={styles.block} testID="deposit-progress">
                {pageHint ? (
                  <View style={[styles.chip, styles.chipInfo]}>
                    <Text style={[styles.chipText, small]}>{pageHint}</Text>
                  </View>
                ) : null}
                <PaymentProgress
                  paymentId={payment.id}
                  initial={payment}
                  doneLabel="Fermer"
                  onDone={onClose}
                />
              </View>
            ) : (
              <>
                {amountBlock}
                {payBlock}
                <View style={styles.status} accessibilityLiveRegion="polite">
                  {unavailable ? (
                    <View style={[styles.chip, styles.chipInfo]}>
                      <Text style={[styles.chipText, small]}>
                        Paiement Mobile Money momentanément indisponible.
                      </Text>
                    </View>
                  ) : notice ? (
                    <View
                      style={[
                        styles.chip,
                        notice.tone === 'error' ? styles.chipWarning : styles.chipInfo,
                      ]}
                    >
                      <Text
                        accessibilityRole={notice.tone === 'error' ? 'alert' : 'text'}
                        style={[styles.chipText, small]}
                      >
                        {notice.text}
                      </Text>
                    </View>
                  ) : processing ? (
                    <View style={styles.row}>
                      <ActivityIndicator color={COLORS.gold} size="small" />
                      <Text style={[styles.muted, small]}>Initialisation du paiement…</Text>
                    </View>
                  ) : null}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** L'unique bouton de paiement : pilule aux couleurs de l'opérateur déduit par le serveur. */
function PayButton({
  operator,
  height,
  fontFamily,
  textSize,
  disabled,
  loading,
  amount,
  onPress,
}: {
  operator: DirectPayOperator;
  height: number;
  fontFamily?: string;
  textSize: number;
  disabled: boolean;
  loading: boolean;
  amount?: number;
  onPress: () => void;
}) {
  const brand = OPERATORS[operator];
  const label = `Payer avec ${DIRECT_PAY_OPERATOR_LABELS[operator]}`;
  const badge = Math.round(height * 0.66);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        amount !== undefined
          ? `Payer ${amount} francs CFA avec ${DIRECT_PAY_OPERATOR_LABELS[operator]}`
          : label
      }
      accessibilityState={{ disabled, busy: loading }}
      style={({ pressed }) => [
        styles.payButton,
        {
          minHeight: height,
          borderRadius: height / 2,
          backgroundColor: brand.background,
          boxShadow: `0 6px 18px ${brand.glow}`,
        },
        disabled && !loading && styles.payButtonDisabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2 }]}>
        <Text
          allowFontScaling={false}
          style={[
            styles.badgeText,
            fontOf(fontFamily),
            { color: brand.badgeText, fontSize: badge * 0.32 },
          ]}
        >
          {brand.badge}
        </Text>
      </View>
      <View style={styles.payText}>
        <Text
          numberOfLines={1}
          style={[styles.payLabel, fontOf(fontFamily), { fontSize: textSize }]}
        >
          {label}
        </Text>
        {amount !== undefined ? (
          <Text numberOfLines={1} style={[styles.payAmount, { fontSize: textSize * 0.8 }]}>
            {formatFcfa(amount)}
          </Text>
        ) : null}
      </View>
      {loading ? <ActivityIndicator color={COLORS.ink} size="small" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: COLORS.backdrop },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    overflow: 'hidden',
    borderRadius: 26,
    backgroundColor: COLORS.cardBottom,
    experimental_backgroundImage: `linear-gradient(165deg, ${COLORS.cardTop} 0%, ${COLORS.cardBottom} 100%)`,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    boxShadow: '0 18px 48px rgba(0, 0, 0, 0.42)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.goldSoft,
    // Accent bordeaux discret de la charte.
    borderWidth: 1,
    borderColor: COLORS.bordeauxSoft,
  },
  title: { flex: 1, color: COLORS.text, letterSpacing: 0.2 },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20, gap: 14 },
  block: { gap: 8, paddingTop: 8 },
  label: { color: COLORS.muted, fontWeight: '600', letterSpacing: 0.2 },
  muted: { color: COLORS.muted },
  errorText: { color: palette.error, fontWeight: '600' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
  },
  fieldError: { borderColor: palette.error },
  input: { flex: 1, paddingVertical: 0, textAlign: 'center', color: COLORS.text },
  centered: { textAlign: 'center' },
  suffix: { color: COLORS.muted, marginLeft: 8 },
  payButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 8,
    paddingRight: 18,
  },
  payButtonDisabled: { opacity: 0.42 },
  badge: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#161616' },
  badgeText: { fontWeight: '900', letterSpacing: 0.5 },
  payText: { flex: 1, gap: 1 },
  payLabel: { color: COLORS.ink },
  payAmount: { color: 'rgba(21, 21, 21, 0.7)', fontWeight: '600' },
  status: { minHeight: 20, justifyContent: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  chipInfo: { backgroundColor: COLORS.info },
  chipWarning: { backgroundColor: COLORS.bordeauxSoft },
  chipText: { color: COLORS.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
});
