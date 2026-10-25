import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { gameTheme, salon } from '../../constants/theme';
import { ApiError } from '../../lib/api-client';
import type { DirectPayOperator, PaymentView, WalletTransactionView } from '../../types/wallet';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { openPaymentPage, useWallet, useWalletOperation } from './hooks';
import {
  checkDepositAmount,
  DEFAULT_DEPOSIT_LIMITS,
  DIRECT_PAY_OPERATOR_LABELS,
  formatFcfa,
} from './payment-state';
import { PaymentProgress } from './PaymentProgress';
import { AmountField } from './TokenAmountField';

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

/**
 * Charte du salon (Ébène & Laiton, constants/theme) : laque sombre, laiton et sang-de-bœuf en
 * accents. Les couleurs des opérateurs (ci-dessus) restent celles de leurs marques.
 */
const COLORS = {
  gold: gameTheme.brass.bright,
  bordeauxSoft: 'rgba(142, 31, 47, 0.26)',
  text: salon.text,
  muted: salon.textSoft,
  ink: '#151515',
  info: salon.status.info.fill,
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
        // Message du serveur, propre à la cause (D-100) : accès au fournisseur suspendu,
        // CinetPay injoignable, incident ou refus. Rien n'a été débité dans tous les cas.
        return {
          tone: 'error',
          text:
            error.message ||
            'Service de paiement momentanément indisponible. Aucun montant n’a été débité.',
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
 * Acheter des jetons (D-085, D-087, D-090, D-091), dans le panneau unique « Mes jetons » : le
 * joueur saisit SEULEMENT le montant. Le moyen de paiement est déduit par le serveur du numéro
 * d'inscription (`paymentOperator`) : un seul bouton, à ses couleurs. L'application n'envoie que
 * le montant ; le serveur choisit le paiement direct puis, sur un refus certain, la page CinetPay
 * (jamais deux paiements). Aucun crédit affiché avant le statut relu sur le serveur
 * (`PaymentProgress`).
 */
export function DepositPane({
  input,
  onInput,
  onClose,
  onDone,
  onLockChange,
}: {
  /** Montant saisi (chiffres), partagé avec « Retirer » dans le panneau. */
  input: string;
  onInput: (value: string) => void;
  onClose: () => void;
  onDone: (transaction: WalletTransactionView) => void;
  /** Achat en cours ou suivi affiché : le choix Acheter / Retirer est verrouillé. */
  onLockChange: (locked: boolean) => void;
}) {
  const m = useLobbyMetrics();
  const wallet = useWallet();
  const operation = useWalletOperation('deposit');
  const [payment, setPayment] = useState<PaymentView>();
  const [notice, setNotice] = useState<Notice>();
  // Achat en cours (montant + clé d'idempotence de l'appui) : un repli vers la page CinetPay
  // est une nouvelle demande du MÊME achat, jamais un second paiement (D-134).
  const [intent, setIntent] = useState<{ tokens: number; key: string }>();
  // Issue inconnue faute de réseau : le nouvel essai du MÊME montant réutilise la même clé,
  // le serveur ne crée donc jamais un second paiement si le premier était parti.
  const [retryKey, setRetryKey] = useState<string>();
  // Paiement direct clos sans débit : repli automatique en cours vers la page CinetPay.
  const [fallingBack, setFallingBack] = useState<string>();
  // Verrou synchrone : deux appuis avant le prochain rendu n'envoient qu'une demande.
  const inFlight = useRef(false);

  const limits = wallet.data?.depositLimits ?? DEFAULT_DEPOSIT_LIMITS;
  // Opérateur décidé par le serveur ; `null` : numéro non pris en charge ; absent : chargement.
  const operator = wallet.data?.paymentOperator;
  const unavailable = wallet.data !== undefined && !wallet.data.mobileMoneyAvailable;
  const check = checkDepositAmount(input, limits);
  const processing = operation.isPending;
  // Vérification en cours : pas de nouvelle demande tant que le joueur n'a pas changé le montant.
  const verifying = notice?.tone === 'pending';
  const small = { fontSize: m.smallSize };
  const field = Math.max(50, Math.round(m.controlHeight * 1.1));

  const locked = processing || payment !== undefined;
  useEffect(() => onLockChange(locked), [locked, onLockChange]);

  /** Une Idempotency-Key par intention ; montant revalidé, moyen choisi par le serveur. */
  const pay = () => {
    if (inFlight.current || processing || unavailable || verifying || !operator || !check.ok) {
      return;
    }
    inFlight.current = true;
    setNotice(undefined);
    operation.reset();
    const key =
      retryKey && intent?.key === retryKey && intent.tokens === check.amount
        ? retryKey
        : operation.newKey();
    setIntent({ tokens: check.amount, key });
    operation.mutate(
      { tokens: check.amount, key },
      {
        onSuccess: (result) => {
          setRetryKey(undefined);
          if (!result.payment) {
            onDone(result.transaction);
            return;
          }
          setPayment(result.payment);
          if (result.payment.paymentUrl) void openPaymentPage(result.payment.paymentUrl);
        },
        onError: (err) => {
          setRetryKey(err instanceof ApiError && err.status === 0 ? key : undefined);
          setNotice(noticeOf(err));
        },
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  /**
   * Paiement DIRECT (MTN) clos par CinetPay sans débit (échoué, expiré) : le même achat passe
   * AUTOMATIQUEMENT par la page CinetPay (D-134). Le serveur revérifie que le direct est bien
   * clos sans débit ; un direct encore en attente n'est jamais doublé.
   */
  const fallBackToPage = (closed: PaymentView) => {
    if (closed.mode !== 'DIRECT' || !intent || fallingBack === closed.id) return;
    if (closed.status !== 'FAILED' && closed.status !== 'EXPIRED') return;
    setFallingBack(closed.id);
    operation.mutate(
      { tokens: intent.tokens, key: intent.key },
      {
        onSuccess: (result) => {
          setFallingBack(undefined);
          if (!result.payment || result.payment.id === closed.id) return;
          setPayment(result.payment);
          if (result.payment.paymentUrl) void openPaymentPage(result.payment.paymentUrl);
        },
        onError: (err) => {
          setFallingBack(undefined);
          setNotice(noticeOf(err));
        },
      },
    );
  };

  // Page générique (opérateur non présélectionné par le serveur) : le dire, sans rien garantir.
  const pageHint =
    payment && payment.mode !== 'DIRECT' && operator && payment.operator !== operator
      ? `Sur la page CinetPay, choisissez ${DIRECT_PAY_OPERATOR_LABELS[operator]}.`
      : undefined;

  if (payment) {
    return (
      <View style={styles.block} testID="deposit-progress">
        {pageHint ? (
          <View style={[styles.chip, styles.chipInfo]}>
            <Text style={[styles.chipText, small]}>{pageHint}</Text>
          </View>
        ) : null}
        {fallingBack ? (
          <View style={styles.row} testID="deposit-page-fallback">
            <ActivityIndicator color={COLORS.gold} size="small" />
            <Text style={[styles.muted, small]}>
              Paiement direct indisponible : ouverture de la page de paiement CinetPay…
            </Text>
          </View>
        ) : (
          <PaymentProgress
            key={payment.id}
            paymentId={payment.id}
            initial={payment}
            doneLabel="Terminé"
            onDone={onClose}
            onFinal={fallBackToPage}
          />
        )}
        {notice ? (
          <View style={[styles.chip, styles.chipWarning]}>
            <Text accessibilityRole="alert" style={[styles.chipText, small]}>
              {notice.text}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <AmountField
        label="Montant de la recharge (FCFA)"
        unit="FCFA"
        value={input}
        maxDigits={9}
        invalid={!check.ok && check.reason !== 'empty'}
        editable={!processing && !unavailable && operator !== null}
        height={field}
        onChange={(value) => {
          if (processing) return;
          operation.reset();
          setNotice(undefined);
          onInput(value);
        }}
        onSubmit={pay}
      />
      {/* Limites non affichées : seul un montant refusé est signalé. */}
      {!check.ok && check.message ? (
        <Text accessibilityRole="alert" style={[styles.errorText, small]}>
          {check.message}
        </Text>
      ) : null}
      {operator ? (
        <OperatorButton
          operator={operator}
          label={`Payer avec ${DIRECT_PAY_OPERATOR_LABELS[operator]}`}
          detail={check.ok ? formatFcfa(check.amount) : undefined}
          accessibilityLabel={
            check.ok
              ? `Payer ${check.amount} francs CFA avec ${DIRECT_PAY_OPERATOR_LABELS[operator]}`
              : undefined
          }
          height={Math.max(52, field)}
          disabled={unavailable || processing || verifying || !check.ok}
          loading={processing}
          onPress={pay}
        />
      ) : operator === null ? (
        <AccountNumberNotice />
      ) : (
        <ActivityIndicator color={COLORS.gold} />
      )}
      <View style={styles.status} accessibilityLiveRegion="polite">
        {unavailable ? (
          <View style={[styles.chip, styles.chipInfo]}>
            <Text style={[styles.chipText, small]}>
              Paiement Mobile Money momentanément indisponible.
            </Text>
          </View>
        ) : notice ? (
          <View
            style={[styles.chip, notice.tone === 'error' ? styles.chipWarning : styles.chipInfo]}
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
    </View>
  );
}

/**
 * Numéro d'inscription hors Mobile Money pris en charge : aucune opération possible depuis le
 * panneau ; le numéro se fait régulariser par l'assistance (jamais modifié ici).
 */
export function AccountNumberNotice({ operation = 'paiement' }: { operation?: 'paiement' | 'retrait' }) {
  const m = useLobbyMetrics();
  return (
    <View style={[styles.chip, styles.chipWarning]}>
      <Text accessibilityRole="alert" style={[styles.chipText, { fontSize: m.smallSize }]}>
        {`Le numéro de votre compte n’est pas un numéro MTN Mobile Money ou Orange Money du Cameroun : aucun ${operation} n’est possible. Contactez l’assistance pour faire vérifier ou mettre à jour votre numéro.`}
      </Text>
    </View>
  );
}

/**
 * Bouton principal d'une opération (acheter, retirer) : pilule aux couleurs de l'opérateur que
 * le SERVEUR a déduit du numéro d'inscription. Aucun autre opérateur n'est proposé.
 */
export function OperatorButton({
  operator,
  label,
  detail,
  accessibilityLabel,
  height,
  disabled,
  loading,
  onPress,
}: {
  operator: DirectPayOperator;
  label: string;
  /** Seconde ligne (montant saisi). */
  detail?: string;
  accessibilityLabel?: string;
  height: number;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const brand = OPERATORS[operator];
  const badge = Math.round(height * 0.66);
  const textSize = m.bodySize;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
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
            fontOf(fonts.button),
            { color: brand.badgeText, fontSize: badge * 0.32 },
          ]}
        >
          {brand.badge}
        </Text>
      </View>
      <View style={styles.payText}>
        <Text
          numberOfLines={1}
          style={[styles.payLabel, fontOf(fonts.button), { fontSize: textSize }]}
        >
          {label}
        </Text>
        {detail !== undefined ? (
          <Text numberOfLines={1} style={[styles.payAmount, { fontSize: textSize * 0.8 }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      {loading ? <ActivityIndicator color={COLORS.ink} size="small" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  muted: { color: COLORS.muted },
  errorText: { color: palette.error, fontWeight: '600', textAlign: 'center' },
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
