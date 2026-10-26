import { useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { EmptyState, StatusBadge } from '../../components/ui/SalonParts';
import { salon, type SalonTone } from '../../constants/theme';
import type { WithdrawalOperator, WithdrawalView } from '../../types/wallet';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { InnerFrame, PanelButton } from '../lobby/LobbyUi';
import { AccountNumberNotice, OperatorButton } from './DepositSheet';
import {
  newIdempotencyKey,
  useRequestWithdrawal,
  useWallet,
  useWithdrawal,
  useWithdrawals,
} from './hooks';
import { formatTokens } from './payment-state';
import { AmountField } from './TokenAmountField';
import {
  checkWithdrawalAmount,
  MIN_WITHDRAWAL_TOKENS,
  withdrawalAvailabilityNotice,
  withdrawalDisplay,
  withdrawalErrorMessage,
} from './withdrawal-state';
import { WithdrawalModeNotice } from './WithdrawalModeNotice';

export type WithdrawalStep =
  | { name: 'form' }
  | { name: 'confirm'; tokens: number; operator: WithdrawalOperator; key: string }
  | { name: 'result'; withdrawal: WithdrawalView }
  | { name: 'history' };

/**
 * Retirer (D-075), dans le panneau unique « Mes jetons », présenté comme l'achat : montant saisi,
 * puis l'unique bouton aux couleurs de l'opérateur. Destinataire : TOUJOURS le numéro
 * d'inscription (masqué), opérateur déduit par le serveur de ce numéro (`paymentOperator`),
 * jamais choisi ni saisi. Confirmation sur place → statut RÉEL relu sur le serveur →
 * historique. Ni frais ni montant net.
 */
export function WithdrawalPane({
  input,
  onInput,
  step,
  onStep,
}: {
  /** Nombre de jetons saisi (chiffres), partagé avec « Acheter » dans le panneau. */
  input: string;
  onInput: (value: string) => void;
  step: WithdrawalStep;
  onStep: (step: WithdrawalStep) => void;
}) {
  const sandbox = useSandboxWithdrawals();
  return (
    <>
      {sandbox ? (
        <WithdrawalModeNotice
          notice={withdrawalAvailabilityNotice({ available: true, mode: 'sandbox' })}
        />
      ) : null}
      <WithdrawalStepView input={input} onInput={onInput} step={step} onStep={onStep} />
    </>
  );
}

function WithdrawalStepView({
  input,
  onInput,
  step,
  onStep,
}: {
  input: string;
  onInput: (value: string) => void;
  step: WithdrawalStep;
  onStep: (step: WithdrawalStep) => void;
}) {
  const toForm = () => onStep({ name: 'form' });

  if (step.name === 'confirm') {
    return (
      <ConfirmStep
        tokens={step.tokens}
        operator={step.operator}
        idempotencyKey={step.key}
        onEdit={toForm}
        onCreated={(withdrawal) => {
          onInput('');
          onStep({ name: 'result', withdrawal });
        }}
      />
    );
  }
  if (step.name === 'result') {
    return (
      <ResultStep
        initial={step.withdrawal}
        onHistory={() => onStep({ name: 'history' })}
        onDone={toForm}
      />
    );
  }
  if (step.name === 'history') return <HistoryStep onBack={toForm} />;
  return (
    <FormStep
      input={input}
      onInput={onInput}
      onHistory={() => onStep({ name: 'history' })}
      onContinue={(tokens, operator) =>
        // Une clé par intention confirmée : tout nouvel essai la réutilise.
        onStep({ name: 'confirm', tokens, operator, key: newIdempotencyKey() })
      }
    />
  );
}

/** Serveur en environnement de test (D-077) : transferts simulés, aucun argent réel. */
export function useSandboxWithdrawals(): boolean {
  const wallet = useWallet();
  const withdrawals = useWithdrawals();
  return (wallet.data?.withdrawalMode ?? withdrawals.data?.policy.mode) === 'sandbox';
}

/**
 * Opérateur du retrait : celui que le serveur a déduit du numéro d'inscription
 * (`paymentOperator`), s'il fait partie des opérateurs de retrait. `null` : numéro non pris
 * en charge ; `undefined` : encore en chargement.
 */
function useAccountOperator(): { code: WithdrawalOperator; label: string } | null | undefined {
  const wallet = useWallet();
  const withdrawals = useWithdrawals();
  const policy = withdrawals.data?.policy;
  if (!wallet.data || !policy) return undefined;
  const code = wallet.data.paymentOperator;
  if (!policy.msisdnSupported || !code) return null;
  return policy.operators.find((o) => o.code === code) ?? null;
}

function FormStep({
  input,
  onInput,
  onHistory,
  onContinue,
}: {
  input: string;
  onInput: (value: string) => void;
  onHistory: () => void;
  onContinue: (tokens: number, operator: WithdrawalOperator) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const wallet = useWallet();
  const withdrawals = useWithdrawals();
  const policy = withdrawals.data?.policy;
  const operator = useAccountOperator();
  const available = wallet.data?.available ?? wallet.data?.balance;
  const check = checkWithdrawalAmount(input, {
    minTokens: policy?.minTokens ?? MIN_WITHDRAWAL_TOKENS,
    maxTokens: policy?.maxTokens ?? Number.MAX_SAFE_INTEGER,
    available,
  });
  const quotaReached = policy?.limit.remaining === 0;
  const blocked = !policy || !policy.available || !operator || quotaReached;
  const field = Math.max(50, Math.round(m.controlHeight * 1.1));
  const msisdn = policy?.msisdn ?? wallet.data?.mobileMoneyNumber;

  const blockedMessage = !policy
    ? undefined
    : !policy.available
      ? withdrawalAvailabilityNotice({
          available: false,
          mode: policy.mode,
          reason: policy.unavailableReason,
        })?.message
      : quotaReached
        ? `Nombre maximal de retraits atteint.${
            policy.limit.nextAvailableAt
              ? ` Prochain retrait possible le ${formatDateTime(policy.limit.nextAvailableAt)}.`
              : ''
          }`
        : undefined;

  return (
    <View style={styles.block}>
      {withdrawalErrorMessage(withdrawals.error) ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {withdrawalErrorMessage(withdrawals.error)}
        </Text>
      ) : null}

      <AmountField
        label="Nombre de jetons à retirer"
        unit="jetons"
        value={input}
        maxDigits={10}
        invalid={!check.ok && check.reason !== 'empty'}
        editable={operator !== null}
        height={field}
        onChange={onInput}
      />
      {!check.ok && check.message ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {check.message}
        </Text>
      ) : null}

      {operator ? (
        <OperatorButton
          operator={operator.code}
          label={`Retirer vers ${operator.label}`}
          detail={check.ok ? `${formatTokens(check.tokens)} · ${msisdn ?? ''}` : msisdn}
          accessibilityLabel={`Continuer le retrait${check.ok ? ` de ${check.tokens} jetons` : ''}`}
          height={Math.max(52, field)}
          disabled={!check.ok || blocked}
          loading={false}
          onPress={() => {
            if (check.ok && !blocked) onContinue(check.tokens, operator.code);
          }}
        />
      ) : operator === null ? (
        <AccountNumberNotice operation="retrait" />
      ) : withdrawals.error ? null : (
        <ActivityIndicator color={palette.gold} />
      )}
      {blockedMessage ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {blockedMessage}
        </Text>
      ) : null}

      <Pressable
        onPress={onHistory}
        accessibilityRole="button"
        hitSlop={8}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <Text style={[styles.linkText, fontOf(fonts.button), { fontSize: m.smallSize }]}>
          Mes retraits
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Confirmation sur place, en une ligne : jetons, opérateur et numéro d'inscription masqué.
 * Pendant l'envoi, les boutons sont bloqués ; un nouvel essai après une erreur réutilise la
 * MÊME clé d'idempotence (jamais deux retraits).
 */
function ConfirmStep({
  tokens,
  operator,
  idempotencyKey,
  onEdit,
  onCreated,
}: {
  tokens: number;
  operator: WithdrawalOperator;
  idempotencyKey: string;
  onEdit: () => void;
  onCreated: (withdrawal: WithdrawalView) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const wallet = useWallet();
  const withdrawals = useWithdrawals();
  const request = useRequestWithdrawal();
  const policy = withdrawals.data?.policy;
  const operatorLabel = policy?.operators.find((o) => o.code === operator)?.label ?? operator;
  const msisdn = policy?.msisdn ?? wallet.data?.mobileMoneyNumber ?? '…';
  const sending = request.isPending;
  // Verrou synchrone : deux appuis avant le prochain rendu n'envoient qu'une demande.
  const inFlight = useRef(false);

  const confirm = () => {
    if (sending || inFlight.current) return;
    inFlight.current = true;
    request.mutate(
      { tokens, operator, key: idempotencyKey },
      {
        onSuccess: (result) => onCreated(result.withdrawal),
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  return (
    <View style={styles.block}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, fontOf(fonts.button), { fontSize: m.bodySize * 1.05 }]}
      >
        Confirmer le retrait
      </Text>
      <Text style={[styles.summary, fontOf(fonts.button), { fontSize: m.bodySize }]}>
        {`${formatTokens(tokens)} vers ${operatorLabel} ${msisdn}`}
      </Text>
      {withdrawalErrorMessage(request.error) ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {withdrawalErrorMessage(request.error)}
        </Text>
      ) : sending ? (
        <Text accessibilityLiveRegion="polite" style={[styles.small, { fontSize: m.smallSize }]}>
          Envoi de la demande…
        </Text>
      ) : null}
      <View style={[styles.row, { gap: m.gap }]}>
        <PanelButton title="Modifier" onPress={onEdit} disabled={sending} />
        <PanelButton
          title={request.error ? 'Réessayer' : 'Confirmer le retrait'}
          tone="danger"
          accessibilityLabel={`Confirmer le retrait de ${tokens} jetons`}
          disabled={sending || !policy}
          loading={sending}
          onPress={confirm}
        />
      </View>
    </View>
  );
}

/** Statut RÉEL du retrait (un seul message d'état) et sa référence, utile à l'assistance. */
function ResultStep({
  initial,
  onHistory,
  onDone,
}: {
  initial: WithdrawalView;
  onHistory: () => void;
  onDone: () => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const query = useWithdrawal(initial.id);
  const withdrawal = query.data ?? initial;
  const sandbox = useSandboxWithdrawals();
  const display = withdrawalDisplay(
    withdrawal.status,
    withdrawal.tokens,
    withdrawal.underReview,
    sandbox,
  );
  return (
    <View style={[styles.block, { alignItems: 'center' }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.status, toneStyle(display.tone), { padding: m.gap * 0.8 }]}
      >
        <Text style={[styles.statusTitle, fontOf(fonts.button), { fontSize: m.bodySize * 1.1 }]}>
          {display.label}
        </Text>
        <Text style={[styles.small, { fontSize: m.smallSize }]}>{display.detail}</Text>
        {display.tone === 'pending' ? (
          <ActivityIndicator color={salon.status.info.text} />
        ) : null}
      </View>
      <Text selectable style={[styles.reference, { fontSize: m.smallSize }]}>
        {`Référence : ${withdrawal.reference}`}
      </Text>
      <View style={[styles.row, { gap: m.gap }]}>
        <PanelButton title="Mes retraits" onPress={onHistory} />
        <PanelButton title="Terminé" onPress={onDone} />
      </View>
    </View>
  );
}

function HistoryStep({ onBack }: { onBack: () => void }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const query = useWithdrawals();
  const items = query.data?.withdrawals ?? [];
  const sandbox = useSandboxWithdrawals();
  return (
    <View style={styles.block}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, fontOf(fonts.button), { fontSize: m.bodySize * 1.05 }]}
      >
        Mes retraits
      </Text>
      {query.isPending ? (
        <ActivityIndicator color={palette.gold} />
      ) : query.error ? (
        withdrawalErrorMessage(query.error) ? (
          <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
            {withdrawalErrorMessage(query.error)}
          </Text>
        ) : null
      ) : items.length === 0 ? (
        <EmptyState
          glyph="🏦"
          title="Aucun retrait pour le moment."
          size={m.smallSize}
          fontFamily={fonts.button}
        />
      ) : (
        <View accessibilityRole="list" style={{ gap: m.gap * 0.5 }}>
          {items.map((w) => {
            const display = withdrawalDisplay(w.status, w.tokens, w.underReview, sandbox);
            return (
              <InnerFrame key={w.id} style={{ gap: 2 }}>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryValue, fontOf(fonts.button), { fontSize: m.bodySize }]}>
                    {formatTokens(w.tokens)}
                  </Text>
                  <StatusBadge
                    label={display.label}
                    tone={STATUS_TONE[display.tone]}
                    size={m.smallSize}
                    fontFamily={fonts.button}
                  />
                </View>
                <Text style={[styles.small, styles.left, { fontSize: m.smallSize }]}>
                  {`${formatDateTime(w.createdAt)} · ${w.operatorLabel} ${w.msisdn}`}
                </Text>
                <Text selectable style={[styles.reference, styles.left, { fontSize: m.smallSize }]}>
                  {`Réf. ${w.reference}`}
                </Text>
              </InnerFrame>
            );
          })}
        </View>
      )}
      <PanelButton title="Nouveau retrait" onPress={onBack} />
    </View>
  );
}

/** Date locale courte : « 10/10/2026 14:05 ». */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Ton d'un retrait selon son état RÉEL : en cours (bleu), confirmé (jade), échoué (rouge).
 * Jamais le laiton des actions : un retrait confirmé ne se confond pas avec un bouton.
 */
const STATUS_TONE: Record<'pending' | 'success' | 'error', SalonTone> = {
  pending: 'info',
  success: 'positive',
  error: 'critical',
};
const toneStyle = (tone: 'pending' | 'success' | 'error') => {
  const colors = salon.status[STATUS_TONE[tone]];
  return { borderColor: colors.border, backgroundColor: colors.fill };
};

const styles = StyleSheet.create({
  block: { gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  heading: { color: salon.text, textAlign: 'center' },
  small: { color: salon.textSoft, textAlign: 'center' },
  left: { textAlign: 'left' },
  error: { color: palette.error, textAlign: 'center', fontWeight: '600' },
  link: { alignSelf: 'center', paddingVertical: 2 },
  linkText: { color: salon.brass.text, textDecorationLine: 'underline' },
  pressed: { opacity: 0.75 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  summary: { color: salon.text, textAlign: 'center', fontVariant: ['tabular-nums'] },
  summaryValue: { color: salon.text, fontVariant: ['tabular-nums'] },
  status: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 4,
    borderRadius: salon.radius.card,
    borderWidth: 1,
  },
  statusTitle: { color: salon.text },
  reference: { color: salon.textFaint, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
