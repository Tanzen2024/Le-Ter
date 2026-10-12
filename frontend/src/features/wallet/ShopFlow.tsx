import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  FeltCircle,
  fontOf,
  useTableFonts,
} from '../../components/table/TableDecor';
import type { WalletOperation, WalletTransactionView } from '../../types/wallet';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { LobbyPanel, PanelButton } from '../lobby/LobbyUi';
import { DepositSheet } from './DepositSheet';
import { useWallet } from './hooks';
import { ChipStack, DepositIllustration } from './ShopIllustrations';
import { withdrawalAvailabilityNotice } from './withdrawal-state';
import { WithdrawalModeNotice } from './WithdrawalModeNotice';
import { WithdrawalPanel } from './WithdrawalPanel';

type Step = 'shop' | WalletOperation;

/** Retour discret affiché dans la Boutique après une opération acceptée par le serveur. */
interface Notice {
  tone: 'success' | 'info';
  title: string;
  detail: string;
}

/**
 * « Ajouter des jetons » : Boutique → Acheter (CinetPay → compte de jeu, D-050) ou Retirer
 * (compte de jeu → Mobile Money personnel, numéro d'inscription, D-075). Le X d'Acheter / Retirer
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
    return <DepositSheet onClose={() => setStep('shop')} onDone={onDone} />;
  }
  return <WithdrawalPanel onBack={() => setStep('shop')} />;
}

/** Achat (D-050) ; les retraits ont leur propre suivi (`WithdrawalPanel`). */
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
      <WithdrawalModeNotice notice={withdrawalNotice} />
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
});
