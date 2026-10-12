import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { fontOf, tablePalette as palette, titleShadow, useTableFonts } from '../../components/table/TableDecor';
import type { WithdrawalOperator, WithdrawalView } from '../../types/wallet';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { ChoiceGroup, Coin, InnerFrame, LobbyPanel, PanelButton } from '../lobby/LobbyUi';
import {
  newIdempotencyKey,
  useRequestWithdrawal,
  useWallet,
  useWithdrawal,
  useWithdrawals,
} from './hooks';
import { formatFcfa, formatTokens } from './payment-state';
import {
  checkWithdrawalAmount,
  MIN_WITHDRAWAL_TOKENS,
  quotaText,
  withdrawalAvailabilityNotice,
  withdrawalDisplay,
  withdrawalErrorMessage,
} from './withdrawal-state';
import { WithdrawalModeNotice } from './WithdrawalModeNotice';

type Step =
  | { name: 'form' }
  | { name: 'confirm'; tokens: number; operator: WithdrawalOperator; key: string }
  | { name: 'result'; withdrawal: WithdrawalView }
  | { name: 'history' };

/**
 * Retirer (D-075) : compte de jeu → compte Mobile Money personnel (numéro d'inscription,
 * masqué). Saisie → confirmation (récapitulatif) → suivi du statut RÉEL relu sur le
 * serveur → historique. Aucun montant, frais, taux ou délai n'est inventé : seules les
 * valeurs renvoyées par le serveur sont affichées.
 */
export function WithdrawalPanel({ onBack }: { onBack: () => void }) {
  const m = useLobbyMetrics();
  const [step, setStep] = useState<Step>({ name: 'form' });
  const [input, setInput] = useState('');
  const [operator, setOperator] = useState<WithdrawalOperator>();
  const width = Math.max(500, m.width * 0.68);
  const sandbox = useSandboxWithdrawals();

  const title =
    step.name === 'history' ? 'Mes retraits' : step.name === 'confirm' ? 'Confirmer le retrait' : 'Retirer';
  // Le X d'une étape intérieure revient à la saisie ; celui de la saisie, à la Boutique.
  const close = step.name === 'form' ? onBack : () => setStep({ name: 'form' });

  return (
    <LobbyPanel title={title} onClose={close} width={width}>
      {sandbox ? (
        <WithdrawalModeNotice notice={withdrawalAvailabilityNotice({ available: true, mode: 'sandbox' })} />
      ) : null}
      {step.name === 'form' ? (
        <FormStep
          input={input}
          operator={operator}
          onInput={setInput}
          onOperator={setOperator}
          onHistory={() => setStep({ name: 'history' })}
          onContinue={(tokens, chosen) =>
            // Une clé par intention confirmée : tout nouvel essai la réutilise.
            setStep({ name: 'confirm', tokens, operator: chosen, key: newIdempotencyKey() })
          }
        />
      ) : step.name === 'confirm' ? (
        <ConfirmStep
          tokens={step.tokens}
          operator={step.operator}
          idempotencyKey={step.key}
          onEdit={() => setStep({ name: 'form' })}
          onCreated={(withdrawal) => {
            setInput('');
            setStep({ name: 'result', withdrawal });
          }}
        />
      ) : step.name === 'result' ? (
        <ResultStep
          initial={step.withdrawal}
          onHistory={() => setStep({ name: 'history' })}
          onDone={onBack}
        />
      ) : (
        <HistoryStep onBack={() => setStep({ name: 'form' })} />
      )}
    </LobbyPanel>
  );
}

/** Serveur en environnement de test (D-077) : transferts simulés, aucun argent réel. */
function useSandboxWithdrawals(): boolean {
  const wallet = useWallet();
  const withdrawals = useWithdrawals();
  return (wallet.data?.withdrawalMode ?? withdrawals.data?.policy.mode) === 'sandbox';
}

function FormStep({
  input,
  operator,
  onInput,
  onOperator,
  onHistory,
  onContinue,
}: {
  input: string;
  operator?: WithdrawalOperator;
  onInput: (value: string) => void;
  onOperator: (operator: WithdrawalOperator) => void;
  onHistory: () => void;
  onContinue: (tokens: number, operator: WithdrawalOperator) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const wallet = useWallet();
  const withdrawals = useWithdrawals();
  const policy = withdrawals.data?.policy;
  const available = wallet.data?.available ?? wallet.data?.balance;
  const check = checkWithdrawalAmount(input, {
    minTokens: policy?.minTokens ?? MIN_WITHDRAWAL_TOKENS,
    maxTokens: policy?.maxTokens ?? Number.MAX_SAFE_INTEGER,
    available,
  });
  const quota = policy ? quotaText(policy.limit) : undefined;
  const quotaReached = policy?.limit.remaining === 0;
  const blocked =
    !policy || !policy.available || !policy.msisdnSupported || quotaReached;
  const canContinue = check.ok && operator !== undefined && !blocked;
  const field = Math.max(40, Math.round(m.controlHeight * 0.9));
  const small = [styles.small, { fontSize: m.smallSize }];

  const blockedMessage = !policy
    ? undefined
    : !policy.available
      ? withdrawalAvailabilityNotice({
          available: false,
          mode: policy.mode,
          reason: policy.unavailableReason,
        })?.message
      : !policy.msisdnSupported
        ? 'Votre numéro d’inscription n’est pas un numéro Mobile Money pris en charge (Cameroun, +237).'
        : quotaReached
          ? `Nombre maximal de retraits atteint.${
              policy.limit.nextAvailableAt
                ? ` Prochain retrait possible le ${formatDateTime(policy.limit.nextAvailableAt)}.`
                : ''
            }`
          : undefined;

  return (
    <View style={{ gap: m.gap * 0.8 }}>
      {withdrawals.isPending ? (
        <ActivityIndicator color={palette.gold} />
      ) : withdrawals.error ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {withdrawalErrorMessage(withdrawals.error)}
        </Text>
      ) : null}

      <Text style={[styles.label, fontOf(fonts.button), { fontSize: m.bodySize }]}>
        Nombre de jetons à retirer
      </Text>
      <View style={[styles.fieldRow, { height: field }]}>
        <TextInput
          value={input}
          onChangeText={(v) => onInput(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          maxLength={10}
          placeholder={String(policy?.minTokens ?? MIN_WITHDRAWAL_TOKENS)}
          placeholderTextColor="rgba(255, 255, 255, 0.45)"
          accessibilityLabel="Nombre de jetons à retirer"
          style={[
            styles.input,
            fontOf(fonts.button),
            { height: field, borderRadius: field * 0.2, fontSize: m.bodySize * 1.3 },
            !check.ok && check.reason !== 'empty' && styles.inputError,
          ]}
        />
        <View style={[styles.inputCoin, { right: -field * 0.25 }]}>
          <Coin size={Math.round(field * 1.1)} fontFamily={fonts.title} />
        </View>
      </View>
      <Text style={small}>
        {`Minimum ${formatTokens(policy?.minTokens ?? MIN_WITHDRAWAL_TOKENS)} · 1 jeton = 1 FCFA`}
        {available !== undefined ? ` · Disponible : ${formatTokens(available)}` : ''}
      </Text>
      {!check.ok && check.message ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {check.message}
        </Text>
      ) : null}

      <Text style={[styles.label, fontOf(fonts.button), { fontSize: m.bodySize }]}>Opérateur</Text>
      <ChoiceGroup>
        {(policy?.operators ?? []).map((o) => (
          <PanelButton
            key={o.code}
            title={o.label}
            selected={operator === o.code}
            onPress={() => onOperator(o.code)}
          />
        ))}
      </ChoiceGroup>
      <Text style={small}>
        {`Destinataire : ${policy?.msisdn ?? wallet.data?.mobileMoneyNumber ?? '…'} (votre numéro d’inscription)`}
      </Text>
      {quota ? <Text style={small}>{quota}</Text> : null}
      {blockedMessage ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {blockedMessage}
        </Text>
      ) : null}

      <View style={[styles.row, { gap: m.gap }]}>
        <PanelButton title="Mes retraits" onPress={onHistory} />
        <PanelButton
          title="Continuer"
          tone="danger"
          accessibilityLabel={`Continuer le retrait${check.ok ? ` de ${check.tokens} jetons` : ''}`}
          disabled={!canContinue}
          onPress={() => {
            if (check.ok && operator) onContinue(check.tokens, operator);
          }}
        />
      </View>
    </View>
  );
}

/**
 * Récapitulatif avant envoi. Pendant l'envoi, les boutons sont bloqués ; un nouvel essai
 * après une erreur réutilise la MÊME clé d'idempotence (jamais deux retraits).
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
  const available = wallet.data?.available ?? wallet.data?.balance;
  const operatorLabel = policy?.operators.find((o) => o.code === operator)?.label ?? operator;
  const sending = request.isPending;
  // Verrou synchrone : deux appuis avant le prochain rendu n'envoient qu'une demande.
  const inFlight = useRef(false);

  const rows: [string, string][] = [
    ['Jetons retirés', formatTokens(tokens)],
    ['Montant envoyé', formatFcfa(tokens * (policy?.tokensPerUnit ?? 1))],
    ['Frais Le Ter', policy?.platformFeeTokens ? formatTokens(policy.platformFeeTokens) : 'Aucun'],
    ['Opérateur', operatorLabel],
    ['Destinataire', policy?.msisdn ?? wallet.data?.mobileMoneyNumber ?? '…'],
    ...(available !== undefined
      ? ([['Disponible après le retrait', formatTokens(Math.max(available - tokens, 0))]] as [
          string,
          string,
        ][])
      : []),
  ];

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
    <View style={{ gap: m.gap * 0.8 }}>
      <InnerFrame style={{ gap: m.gap * 0.4 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { fontSize: m.smallSize * 1.05 }]}>{label}</Text>
            <Text style={[styles.summaryValue, fontOf(fonts.button), { fontSize: m.bodySize }]}>
              {value}
            </Text>
          </View>
        ))}
      </InnerFrame>
      <Text style={[styles.small, { fontSize: m.smallSize }]}>
        Les jetons sont réservés dès la confirmation. Si le transfert échoue, ils sont recrédités.
        Les éventuels frais de votre opérateur ne sont pas connus de Le Ter.
      </Text>
      {request.error ? (
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
    <View style={{ gap: m.gap * 0.8, alignItems: 'center' }}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.status, toneStyle(display.tone), { padding: m.gap * 0.8 }]}
      >
        <Text style={[styles.statusTitle, fontOf(fonts.button), { fontSize: m.bodySize * 1.1 }]}>
          {display.label}
        </Text>
        <Text style={[styles.small, { fontSize: m.smallSize }]}>{display.detail}</Text>
        {display.tone === 'pending' ? <ActivityIndicator color={palette.gold} /> : null}
      </View>
      <Text style={[styles.small, { fontSize: m.smallSize }]}>
        {`${formatTokens(withdrawal.tokens)} → ${withdrawal.operatorLabel} ${withdrawal.msisdn}`}
      </Text>
      <Text selectable style={[styles.reference, { fontSize: m.smallSize }]}>
        {`Référence : ${withdrawal.reference}`}
      </Text>
      <View style={[styles.row, { gap: m.gap }]}>
        <PanelButton title="Mes retraits" onPress={onHistory} />
        <PanelButton title="Retour à la Boutique" onPress={onDone} />
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
    <View style={{ gap: m.gap * 0.6 }}>
      {query.isPending ? (
        <ActivityIndicator color={palette.gold} />
      ) : query.error ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {withdrawalErrorMessage(query.error)}
        </Text>
      ) : items.length === 0 ? (
        <Text style={[styles.small, { fontSize: m.smallSize }]}>Aucun retrait pour le moment.</Text>
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
                  <Text style={[styles.badge, toneText(display.tone), { fontSize: m.smallSize }]}>
                    {display.label}
                  </Text>
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

const toneStyle = (tone: 'pending' | 'success' | 'error') =>
  tone === 'success' ? styles.success : tone === 'error' ? styles.failure : styles.pending;
const toneText = (tone: 'pending' | 'success' | 'error') =>
  tone === 'success' ? styles.successText : tone === 'error' ? styles.failureText : styles.pendingText;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  label: { color: '#FFFFFF', textAlign: 'center', ...titleShadow },
  small: { color: 'rgba(255, 255, 255, 0.78)', textAlign: 'center' },
  left: { textAlign: 'left' },
  error: { color: palette.error, textAlign: 'center', fontWeight: '600' },
  fieldRow: { alignSelf: 'center', width: '70%', flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: 0,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  inputError: { borderColor: palette.error },
  inputCoin: { position: 'absolute' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  summaryLabel: { color: 'rgba(255, 255, 255, 0.75)' },
  summaryValue: { color: '#FFFFFF' },
  status: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusTitle: { color: '#FFFFFF' },
  pending: { borderColor: 'rgba(255, 255, 255, 0.2)', backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  success: { borderColor: 'rgba(242, 196, 81, 0.5)', backgroundColor: 'rgba(242, 196, 81, 0.12)' },
  failure: { borderColor: 'rgba(230, 80, 80, 0.5)', backgroundColor: 'rgba(230, 80, 80, 0.12)' },
  badge: { fontWeight: '700' },
  pendingText: { color: 'rgba(255, 255, 255, 0.85)' },
  successText: { color: palette.gold },
  failureText: { color: palette.error },
  reference: { color: 'rgba(255, 255, 255, 0.65)', textAlign: 'center', fontVariant: ['tabular-nums'] },
});
