import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  FeltCircle,
  fontOf,
  tablePalette as palette,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { ApiError } from '../../lib/api-client';
import type { PaymentView, WalletOperation, WalletTransactionView } from '../../types/wallet';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { Coin, LobbyPanel, PanelButton } from '../lobby/LobbyUi';
import { openPaymentPage, parseTokens, useWallet, useWalletOperation } from './hooks';
import { DEPOSIT_AMOUNTS, formatFcfa } from './payment-state';
import { PaymentProgress } from './PaymentProgress';
import { ChipStack, DepositIllustration, Safe } from './ShopIllustrations';

type Step = 'shop' | WalletOperation;

/** Retour discret affiché dans la Boutique après une opération acceptée par le serveur. */
interface Notice {
  tone: 'success' | 'info';
  title: string;
  detail: string;
}

/**
 * « Ajouter des jetons » : Boutique → Acheter (CinetPay → compte de jeu, D-050) ou Retirer
 * (compte de jeu → Mobile Money personnel, numéro d'inscription). Le X d'Acheter / Retirer
 * (et le retour Android) ramène à la Boutique ; celui de la Boutique ferme le parcours.
 *
 * Le solde n'est jamais modifié par l'écran : seule la réponse du serveur le change.
 */
export function ShopFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('shop');
  const [notice, setNotice] = useState<Notice>();
  if (step === 'shop') {
    return (
      <ShopPanel
        notice={notice}
        onClose={onClose}
        onSelect={(next) => {
          setNotice(undefined);
          setStep(next);
        }}
      />
    );
  }
  const onDone = (transaction: WalletTransactionView) => {
    setNotice(noticeOf(transaction));
    setStep('shop');
  };
  if (step === 'deposit') {
    return <DepositPanel onBack={() => setStep('shop')} onDone={onDone} />;
  }
  return <TokenFormPanel key={step} kind={step} onBack={() => setStep('shop')} onDone={onDone} />;
}

/**
 * Acheter (D-050) : « Recharger mon wallet » → 500 / 1 000 / 2 000 / 5 000 FCFA (1 FCFA =
 * 1 jeton). Le serveur crée le paiement CinetPay ; sa page s'ouvre dans un navigateur
 * intégré ; l'écran suit ensuite le statut RÉEL du paiement, relu sur le serveur.
 */
function DepositPanel({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: (transaction: WalletTransactionView) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const wallet = useWallet();
  const operation = useWalletOperation('deposit');
  const [selected, setSelected] = useState<number>();
  const [payment, setPayment] = useState<PaymentView>();

  const width = Math.max(480, m.width * 0.68);
  const diameter = Math.round(
    Math.min(m.availableHeight - m.panelTitleSize * 1.4 - m.gap * 3, width * 0.5, 420),
  );
  const column = Math.round(diameter * 0.8);
  const small = [styles.smallText, { fontSize: m.smallSize }];
  const unavailable = wallet.data !== undefined && !wallet.data.mobileMoneyAvailable;
  const processing = operation.isPending;
  const failure = operation.error ? depositFailureOf(operation.error) : undefined;

  const choose = (amount: number) => {
    if (processing || unavailable) return;
    setSelected(amount);
    operation.reset();
    operation.mutate(
      { tokens: amount, key: operation.newKey() },
      {
        onSuccess: (result) => {
          if (!result.payment) {
            onDone(result.transaction);
            return;
          }
          setPayment(result.payment);
          if (result.payment.paymentUrl) void openPaymentPage(result.payment.paymentUrl);
        },
      },
    );
  };

  return (
    <LobbyPanel title="Acheter" onClose={onBack} width={width}>
      <View style={[styles.formStage, { height: diameter }]}>
        <ChipStack size={diameter * 0.32} layers={3} style={styles.cornerChips} />
        <Safe size={diameter * 0.36} style={styles.cornerSafe} />
        <View style={styles.centered}>
          <FeltCircle
            diameter={diameter}
            ring={Math.max(5, diameter * 0.025)}
            variant="deep"
            fontFamily={fonts.button}
          />
          <View style={[StyleSheet.absoluteFill, styles.centered]}>
            <View style={{ width: column, gap: m.gap * 0.7, alignItems: 'center' }}>
              {payment ? (
                <PaymentProgress
                  paymentId={payment.id}
                  initial={payment}
                  doneLabel="Retour à la Boutique"
                  onDone={onBack}
                />
              ) : (
                <>
                  <Text style={[styles.prompt, fontOf(fonts.button), { fontSize: m.bodySize }]}>
                    Recharger mon wallet
                  </Text>
                  <View style={[styles.amounts, { gap: m.gap * 0.5 }]} accessibilityRole="list">
                    {DEPOSIT_AMOUNTS.map((amount) => (
                      <PanelButton
                        key={amount}
                        title={formatFcfa(amount)}
                        accessibilityLabel={`Recharger ${amount} francs CFA`}
                        disabled={unavailable || (processing && selected !== amount)}
                        loading={processing && selected === amount}
                        onPress={() => choose(amount)}
                      />
                    ))}
                  </View>
                  <Text style={small}>1 FCFA = 1 jeton · paiement sécurisé CinetPay</Text>
                  {failure ? (
                    <Text
                      accessibilityRole="alert"
                      style={[styles.error, { fontSize: m.smallSize }]}
                    >
                      {failure}
                    </Text>
                  ) : processing ? (
                    <Text accessibilityLiveRegion="polite" style={small}>
                      Création du paiement…
                    </Text>
                  ) : unavailable ? (
                    <Text style={small}>Mobile Money bientôt disponible.</Text>
                  ) : null}
                </>
              )}
            </View>
          </View>
        </View>
      </View>
    </LobbyPanel>
  );
}

/** Refus de création du paiement : le bouton redevient disponible, rien n'a été débité. */
function depositFailureOf(error: unknown): string {
  if (error instanceof ApiError && error.status === 0) {
    return 'Impossible de contacter le service de paiement. Réessayez.';
  }
  return error instanceof ApiError ? `Paiement impossible. ${error.message}` : 'Paiement impossible.';
}

function noticeOf(t: WalletTransactionView): Notice {
  const tokens = `${t.tokens} jeton${t.tokens > 1 ? 's' : ''}`;
  if (t.kind === 'deposit') {
    return t.status === 'succeeded'
      ? { tone: 'success', title: 'Achat effectué avec succès', detail: `+${tokens}` }
      : {
          tone: 'info',
          title: 'Paiement demandé',
          detail: `Confirmez le paiement sur votre téléphone : ${tokens} seront crédités ensuite.`,
        };
  }
  return t.status === 'succeeded'
    ? { tone: 'success', title: 'Retrait effectué avec succès', detail: `−${tokens}` }
    : {
        tone: 'info',
        title: 'Retrait en cours',
        detail: `${tokens} débités, transfert vers votre compte Mobile Money en cours.`,
      };
}

function ShopPanel({
  notice,
  onClose,
  onSelect,
}: {
  notice?: Notice;
  onClose: () => void;
  onSelect: (step: WalletOperation) => void;
}) {
  const m = useLobbyMetrics();
  const wallet = useWallet();
  // Retrait proposé seulement si le serveur annonce un fournisseur capable de transférer.
  const withdrawalAvailable = wallet.data?.withdrawalAvailable === true;
  const width = Math.max(500, m.width * 0.68);
  const zoneHeight = Math.round(Math.min(m.availableHeight * 0.62, 340));
  const art = Math.round(zoneHeight * 0.62);
  return (
    <LobbyPanel title="Boutique" onClose={onClose} width={width}>
      {notice ? <NoticeBanner notice={notice} /> : null}
      <View style={[styles.zones, { gap: m.gap * 1.5, height: zoneHeight }]}>
        {/* Le cercle de la table transparaît derrière les deux choix. */}
        <View style={[StyleSheet.absoluteFill, styles.centered, styles.passThrough]}>
          <FeltCircle
            diameter={zoneHeight * 1.08}
            ring={Math.max(5, zoneHeight * 0.03)}
            variant="deep"
          />
        </View>
        <View style={[styles.zone, styles.zoneBuy, { padding: m.gap }]}>
          <View style={styles.zoneArt}>
            <DepositIllustration size={art} />
          </View>
          <PanelButton
            title="Acheter"
            accessibilityLabel="Acheter des jetons"
            onPress={() => onSelect('deposit')}
          />
        </View>
        <View style={[styles.zone, styles.zoneWithdraw, { padding: m.gap }]}>
          <View style={styles.zoneArt}>
            <ChipStack size={art * 0.62} layers={4} />
          </View>
          <PanelButton
            title="Retirer"
            tone="danger"
            accessibilityLabel="Retirer des jetons vers Mobile Money"
            disabled={!withdrawalAvailable}
            onPress={() => onSelect('withdrawal')}
          />
        </View>
      </View>
      {wallet.data && !withdrawalAvailable ? (
        <Text style={[styles.smallText, { fontSize: m.smallSize, marginTop: m.gap * 0.6 }]}>
          Les retraits Mobile Money seront bientôt disponibles.
        </Text>
      ) : null}
    </LobbyPanel>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        notice.tone === 'success' && styles.noticeSuccess,
        { padding: m.gap * 0.6, marginBottom: m.gap * 0.6 },
      ]}
    >
      <Text style={[styles.noticeTitle, fontOf(fonts.button), { fontSize: m.bodySize }]}>
        {notice.title}
      </Text>
      <Text style={[styles.noticeDetail, { fontSize: m.smallSize }]}>{notice.detail}</Text>
    </View>
  );
}

const TEXTS: Record<WalletOperation, { title: string; prompt: string; action: string }> = {
  deposit: {
    title: 'Acheter',
    prompt: 'Entrer le nombre de jetons à acheter',
    action: 'Acheter',
  },
  withdrawal: {
    title: 'Retirer',
    prompt: 'Entrer le nombre de jetons à retirer',
    action: 'Retirer',
  },
};

/**
 * Acheter / Retirer : grand cercle de feutre, saisie du nombre de jetons, bouton d'action.
 * États : saisie → traitement (bouton bloqué, « Traitement en cours… ») → succès (retour à
 * la Boutique avec un message discret) ou échec (message, saisie conservée).
 */
function TokenFormPanel({
  kind,
  onBack,
  onDone,
}: {
  kind: WalletOperation;
  onBack: () => void;
  onDone: (transaction: WalletTransactionView) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const wallet = useWallet();
  const operation = useWalletOperation(kind);
  const [input, setInput] = useState('');
  const texts = TEXTS[kind];

  const tokens = parseTokens(input);
  const balance = wallet.data?.balance;
  const insufficient =
    kind === 'withdrawal' && tokens !== undefined && balance !== undefined && tokens > balance;
  const invalid = input !== '' && tokens === undefined;
  const processing = operation.isPending;
  const providerReady =
    kind === 'withdrawal' ? wallet.data?.withdrawalAvailable === true : true;
  const canSubmit = tokens !== undefined && !insufficient && !processing && providerReady;
  const failure = operation.error instanceof ApiError ? operation.error.message : undefined;
  const message = insufficient
    ? 'Solde insuffisant.'
    : invalid
      ? 'Entrez un nombre entier de jetons supérieur à 0.'
      : failure;

  const width = Math.max(480, m.width * 0.68);
  const diameter = Math.round(
    Math.min(m.availableHeight - m.panelTitleSize * 1.4 - m.gap * 3, width * 0.5, 420),
  );
  const column = Math.round(diameter * 0.74);
  const field = Math.max(40, Math.round(m.controlHeight * 0.9));
  const small = [styles.smallText, { fontSize: m.smallSize }];

  const submit = () => {
    if (!canSubmit || tokens === undefined) return;
    operation.reset();
    operation.mutate(
      { tokens, key: operation.newKey() },
      { onSuccess: ({ transaction }) => onDone(transaction) },
    );
  };

  return (
    <LobbyPanel title={texts.title} onClose={onBack} width={width}>
      <View style={[styles.formStage, { height: diameter }]}>
        <ChipStack size={diameter * 0.32} layers={3} style={styles.cornerChips} />
        <Safe size={diameter * 0.36} style={styles.cornerSafe} />
        <View style={styles.centered}>
          <FeltCircle
            diameter={diameter}
            ring={Math.max(5, diameter * 0.025)}
            variant="deep"
            fontFamily={fonts.button}
          />
          <View style={[StyleSheet.absoluteFill, styles.centered]}>
            <View style={{ width: column, gap: m.gap * 0.7, alignItems: 'center' }}>
              <Text style={[styles.prompt, fontOf(fonts.button), { fontSize: m.bodySize }]}>
                {texts.prompt}
              </Text>
              <View style={[styles.fieldRow, { height: field }]}>
                <TextInput
                  value={input}
                  onChangeText={(v) => {
                    setInput(v.replace(/[^0-9]/g, ''));
                    if (operation.error) operation.reset();
                  }}
                  editable={!processing}
                  keyboardType="number-pad"
                  maxLength={10}
                  placeholder="0"
                  placeholderTextColor="rgba(255, 255, 255, 0.55)"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  accessibilityLabel={texts.prompt}
                  style={[
                    styles.input,
                    fontOf(fonts.button),
                    { height: field, borderRadius: field * 0.2, fontSize: m.bodySize * 1.3 },
                    (invalid || insufficient) && styles.inputError,
                  ]}
                />
                <View style={[styles.inputCoin, { right: -field * 0.25 }]}>
                  <Coin size={Math.round(field * 1.1)} fontFamily={fonts.title} />
                </View>
              </View>
              {wallet.data ? (
                <Text style={small} numberOfLines={2}>
                  {kind === 'withdrawal'
                    ? `Solde : ${wallet.data.balance} · vers ${wallet.data.mobileMoneyNumber}`
                    : `Depuis le Mobile Money ${wallet.data.mobileMoneyNumber}`}
                </Text>
              ) : null}
              {message ? (
                <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
                  {message}
                </Text>
              ) : processing ? (
                <Text accessibilityLiveRegion="polite" style={small}>
                  Traitement en cours…
                </Text>
              ) : wallet.data && !wallet.data.withdrawalAvailable ? (
                <Text style={small}>Retraits bientôt disponibles.</Text>
              ) : null}
              <PanelButton
                title={processing ? 'Traitement…' : texts.action}
                accessibilityLabel={`${texts.action} ${tokens ?? ''} jetons`.trim()}
                disabled={!canSubmit}
                loading={processing}
                onPress={submit}
              />
            </View>
          </View>
        </View>
      </View>
    </LobbyPanel>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center' },
  passThrough: { pointerEvents: 'none' },
  zones: { flexDirection: 'row' },
  zone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  zoneBuy: { backgroundColor: 'rgba(24, 150, 110, 0.32)' },
  zoneWithdraw: { backgroundColor: 'rgba(200, 40, 40, 0.32)' },
  zoneArt: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  notice: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  noticeSuccess: {
    borderColor: 'rgba(242, 196, 81, 0.5)',
    backgroundColor: 'rgba(242, 196, 81, 0.12)',
  },
  noticeTitle: { color: '#FFFFFF' },
  noticeDetail: { color: 'rgba(255, 255, 255, 0.8)', textAlign: 'center' },
  formStage: { justifyContent: 'center' },
  cornerChips: { position: 'absolute', left: 0, top: 0 },
  cornerSafe: { position: 'absolute', right: 0, bottom: 0 },
  prompt: { color: '#FFFFFF', textAlign: 'center', ...titleShadow },
  fieldRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' },
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
  smallText: { color: 'rgba(255, 255, 255, 0.78)', textAlign: 'center' },
  error: { color: palette.error, textAlign: 'center', fontWeight: '600' },
});
