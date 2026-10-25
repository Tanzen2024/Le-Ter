import { Wallet, X } from 'lucide-react-native';
import { useCallback, useContext, useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fontOf, useTableFonts } from '../../components/table/TableDecor';
import { ExclusiveOverlay } from '../../components/ui/ExclusiveOverlay';
import { gameTheme, motion, salon } from '../../constants/theme';
import type { WalletOperation, WalletTransactionView } from '../../types/wallet';
import { useBackToClose } from '../games/table/GameOverlays';
import { useReducedMotion } from '../games/table/turn-signal';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { Coin, HudInsetsContext } from '../lobby/LobbyUi';
import { DepositPane } from './DepositSheet';
import { useWallet } from './hooks';
import { formatNumber } from './payment-state';
import { withdrawalAvailabilityNotice } from './withdrawal-state';
import { WithdrawalModeNotice } from './WithdrawalModeNotice';
import { WithdrawalPane, type WithdrawalStep } from './WithdrawalPanel';

/** Retour discret affiché dans le panneau après un achat réglé aussitôt par le serveur. */
interface Notice {
  tone: 'success' | 'info';
  title: string;
  detail: string;
}

/**
 * « Mes jetons », ouvert par `+L` : UN seul panneau compact. Solde disponible, choix Acheter /
 * Retirer sur place, montant saisi à la main, puis l'action. Acheter : CinetPay → compte de jeu
 * (D-050) ; Retirer : compte de jeu → Mobile Money personnel, numéro d'inscription (D-075).
 * Le X ferme le panneau ; le retour Android revient d'abord à la saisie.
 *
 * Le solde n'est jamais modifié par l'écran : seule la réponse du serveur le change.
 */
export function ShopFlow({ onClose }: { onClose: () => void }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const wallet = useWallet();
  const [mode, setMode] = useState<WalletOperation>('deposit');
  // Montant saisi, conservé d'une opération à l'autre (1 jeton = 1 FCFA, D-050).
  const [amount, setAmount] = useState('');
  const [withdrawalStep, setWithdrawalStep] = useState<WithdrawalStep>({ name: 'form' });
  const [depositLocked, setDepositLocked] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  // Achat lancé, ou retrait au-delà de la saisie : l'opération n'est plus changée en route.
  const locked = mode === 'deposit' ? depositLocked : withdrawalStep.name !== 'form';

  // Retour Android : une étape intérieure du retrait revient à la saisie ; sinon, fermer.
  const back = useCallback(() => {
    if (mode === 'withdrawal' && withdrawalStep.name !== 'form') {
      setWithdrawalStep({ name: 'form' });
    } else {
      onClose();
    }
  }, [mode, withdrawalStep.name, onClose]);
  useBackToClose(back);

  // Retrait proposé seulement si le serveur l'accepte (test ou production, D-077) ; il
  // revérifie de toute façon chaque demande.
  const withdrawalAvailable = wallet.data?.withdrawalAvailable === true;
  const withdrawalNotice = wallet.data
    ? withdrawalAvailabilityNotice({
        available: withdrawalAvailable,
        mode: wallet.data.withdrawalMode,
        reason: wallet.data.withdrawalUnavailableReason,
      })
    : undefined;
  // Solde DISPONIBLE (hors jetons réservés par un retrait en cours), lu sur le serveur.
  const available = wallet.data?.available ?? wallet.data?.balance;

  const select = (next: WalletOperation) => {
    if (locked || next === mode) return;
    setNotice(undefined);
    setMode(next);
  };
  const onDeposited = (transaction: WalletTransactionView) => {
    setAmount('');
    setNotice(noticeOf(transaction));
  };

  // Une colonne compacte et centrée, quelle que soit l'orientation ; HUD de la coquille
  // toujours visible (D-133) : le panneau reste entre ses deux blocs.
  const hud = useContext(HudInsetsContext);
  const side =
    hud.left > 0 || hud.right > 0
      ? Math.max(m.safe.left, m.safe.right, hud.left + m.gap * 0.5, hud.right + m.gap * 0.5)
      : Math.max(m.safe.left, m.safe.right);
  const width = Math.min(440, m.width - side * 2 - 16);
  const maxHeight = m.height - m.safe.top - m.safe.bottom - 16;
  const title = Math.round(m.bodySize * 1.1);
  const small = { fontSize: m.smallSize };

  return (
    <ExclusiveOverlay style={styles.backdrop}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.center}
      >
        <View
          accessibilityViewIsModal
          testID="token-sheet"
          style={[styles.card, { width, maxHeight }]}
        >
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Wallet size={Math.round(title * 1.05)} color={gameTheme.brass.bright} strokeWidth={1.8} />
            </View>
            <View style={styles.headerText}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[styles.title, fontOf(fonts.button), { fontSize: title }]}
              >
                Mes jetons
              </Text>
              <View
                testID="token-sheet-balance"
                accessible
                accessibilityLabel={
                  available === undefined
                    ? 'Solde disponible en cours de chargement'
                    : `Solde disponible : ${available} jetons`
                }
                style={styles.balance}
              >
                <Text style={[styles.muted, small]}>Disponible</Text>
                <Text style={[styles.balanceValue, fontOf(fonts.button), { fontSize: m.bodySize }]}>
                  {available === undefined ? '…' : formatNumber(available)}
                </Text>
                <Coin size={Math.round(m.bodySize * 1.15)} fontFamily={fonts.title} />
              </View>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              hitSlop={10}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <X size={Math.round(title * 0.95)} color={salon.textSoft} strokeWidth={2} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <OperationSwitch
              mode={mode}
              locked={locked}
              withdrawalAvailable={withdrawalAvailable}
              onSelect={select}
            />
            {/* Retrait fermé : la raison, sous le choix. Le mode test est annoncé côté retrait. */}
            {withdrawalNotice?.tone === 'unavailable' ? (
              <WithdrawalModeNotice notice={withdrawalNotice} />
            ) : null}
            {notice ? <NoticeBanner notice={notice} /> : null}
            {mode === 'deposit' ? (
              <DepositPane
                input={amount}
                onInput={(value) => {
                  setNotice(undefined);
                  setAmount(value);
                }}
                onClose={onClose}
                onDone={onDeposited}
                onLockChange={setDepositLocked}
              />
            ) : (
              <WithdrawalPane
                input={amount}
                onInput={setAmount}
                step={withdrawalStep}
                onStep={setWithdrawalStep}
              />
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </ExclusiveOverlay>
  );
}

/** Achat réglé dès la réponse du serveur (sans page de paiement). */
function noticeOf(t: WalletTransactionView): Notice {
  const tokens = `${t.tokens} jeton${t.tokens > 1 ? 's' : ''}`;
  return t.status === 'succeeded'
    ? { tone: 'success', title: 'Achat effectué avec succès', detail: `+${tokens}` }
    : {
        tone: 'info',
        title: 'Paiement demandé',
        detail: `Confirmez le paiement sur votre téléphone : ${tokens} seront crédités ensuite.`,
      };
}

/**
 * Acheter / Retirer, côte à côte dans le panneau : l'onglet choisi se teinte (émeraude pour
 * acheter, sang-de-bœuf pour retirer) et glisse discrètement, sans animation si « réduire les
 * animations » est actif. Retirer n'est actif que si le serveur l'accepte.
 */
function OperationSwitch({
  mode,
  locked,
  withdrawalAvailable,
  onSelect,
}: {
  mode: WalletOperation;
  locked: boolean;
  withdrawalAvailable: boolean;
  onSelect: (mode: WalletOperation) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [slide] = useState(() => new Animated.Value(mode === 'deposit' ? 0 : 1));
  useEffect(() => {
    const to = mode === 'deposit' ? 0 : 1;
    if (reduced) {
      slide.setValue(to);
      return;
    }
    const animation = Animated.timing(slide, {
      toValue: to,
      duration: motion.select,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [mode, reduced, slide]);

  const height = Math.max(40, Math.round(m.controlHeight * 0.9));
  const half = Math.max(0, (width - 8) / 2);
  const tabs: { key: WalletOperation; title: string; label: string; disabled: boolean }[] = [
    { key: 'deposit', title: 'Acheter', label: 'Acheter des jetons', disabled: false },
    {
      key: 'withdrawal',
      title: 'Retirer',
      label: 'Retirer des jetons vers Mobile Money',
      disabled: !withdrawalAvailable,
    },
  ];
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.switch, { height }, locked && styles.switchLocked]}
    >
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            mode === 'deposit' ? styles.indicatorBuy : styles.indicatorWithdraw,
            {
              width: half,
              transform: [
                { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, half] }) },
              ],
            },
          ]}
        />
      ) : null}
      {tabs.map((tab) => {
        const selected = mode === tab.key;
        const disabled = tab.disabled || (locked && !selected);
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected, disabled }}
            style={[styles.tab, disabled && !selected && styles.tabDisabled]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.tabText,
                selected && styles.tabTextSelected,
                fontOf(fonts.button),
                { fontSize: m.bodySize },
              ]}
            >
              {tab.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
        { padding: m.gap * 0.6 },
      ]}
    >
      <Text style={[styles.noticeTitle, fontOf(fonts.button), { fontSize: m.bodySize }]}>
        {notice.title}
      </Text>
      <Text style={[styles.noticeDetail, { fontSize: m.smallSize }]}>{notice.detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#09110F',
    experimental_backgroundImage: 'linear-gradient(165deg, #1B2924 0%, #09110F 100%)',
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    boxShadow: `${salon.surface.shadow}, inset 0 1px 0 rgba(246, 239, 223, 0.07)`,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 4,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(214, 178, 94, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(142, 31, 47, 0.26)',
  },
  headerText: { flex: 1, gap: 1 },
  title: { color: salon.text, letterSpacing: 0.2 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balanceValue: { color: salon.brass.text, fontVariant: ['tabular-nums'] },
  muted: { color: salon.textSoft },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 18, gap: 12 },
  switch: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: salon.surface.wellBorder,
    backgroundColor: salon.surface.well,
  },
  switchLocked: { opacity: 0.7 },
  indicator: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 10, borderWidth: 1 },
  indicatorBuy: {
    borderColor: salon.emerald.border,
    backgroundColor: salon.emerald.fill,
    experimental_backgroundImage: salon.emerald.gradient,
  },
  indicatorWithdraw: {
    borderColor: salon.oxblood.border,
    backgroundColor: salon.oxblood.fill,
    experimental_backgroundImage: salon.oxblood.gradient,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabDisabled: { opacity: 0.4 },
  tabText: { color: salon.textSoft },
  tabTextSelected: { color: salon.text },
  notice: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: salon.status.info.border,
    backgroundColor: salon.status.info.fill,
    alignItems: 'center',
  },
  noticeSuccess: {
    borderColor: salon.status.positive.border,
    backgroundColor: salon.status.positive.fill,
  },
  noticeTitle: { color: salon.text },
  noticeDetail: { color: salon.textSoft, textAlign: 'center' },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
});
