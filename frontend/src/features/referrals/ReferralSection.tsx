import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { EmptyState, StatusBadge as SalonStatusBadge } from '../../components/ui/SalonParts';
import { gameTheme, salon, type SalonTone } from '../../constants/theme';
import { userErrorMessage } from '../../lib/api-client';
import type { RefereeStatus, ReferralProgram } from '../../types/referral';
import { Body, Card, formatDateTime, Heading } from '../complaints/ComplaintUi';
import { PanelButton } from '../lobby/LobbyUi';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useReferralProgram } from './hooks';
import { useReferralMessages, type ReferralMessages } from './referral-messages';

const STATUS_TONE: Record<RefereeStatus, SalonTone> = {
  IN_PROGRESS: 'info',
  QUALIFIED: 'positive',
  UNDER_REVIEW: 'attention',
  NOT_COUNTED: 'neutral',
};

/**
 * Section Parrainage d'« Aide et réclamations » (D-161). Toujours présente, avant le premier
 * filleul comme après chaque récompense, y compris pendant une suspension (état expliqué).
 * Tout vient du serveur (`GET /api/referrals/me`) : aucune qualification, aucun palier et aucun
 * montant n'est calculé ici.
 */
export function ReferralSection() {
  const t = useReferralMessages();
  const m = useLobbyMetrics();
  const program = useReferralProgram();

  if (program.isPending) return <ActivityIndicator color={palette.gold} />;
  if (program.error || !program.data) {
    return (
      <Card>
        <Text style={styles.error}>{userErrorMessage(program.error)}</Text>
        <PanelButton title={t.retry} onPress={() => void program.refetch()} />
      </Card>
    );
  }
  const data = program.data;
  return (
    <ScrollView testID="referral-section" contentContainerStyle={{ gap: m.gap * 0.6 }}>
      <InviteCard data={data} t={t} />
      <ProgressCard data={data} t={t} />
      <RefereeList data={data} t={t} />
      {data.rewards.length > 0 ? (
        <Card>
          <Heading>{t.rewards}</Heading>
          {data.rewards.map((r) => (
            <Body key={r.tier}>
              {t.reward(r.tier, t.tokens(r.amount))} · {formatDateTime(r.creditedAt, t.locale)}
            </Body>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

interface Part {
  data: ReferralProgram;
  t: ReferralMessages;
}

function InviteCard({ data, t }: Part) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const [copied, setCopied] = useState(false);
  const { rules } = data.campaign;
  const copy = async () => {
    await Clipboard.setStringAsync(data.code);
    setCopied(true);
  };
  const share = () =>
    void Share.share({ message: t.shareMessage(data.code, data.links.invite) }).catch(() => undefined);
  return (
    <Card>
      <Heading>{t.title}</Heading>
      <Body muted>
        {t.intro(rules.referralsPerTier, t.tokens(rules.qualificationThreshold), t.tokens(rules.rewardPerTier))}
      </Body>
      {data.campaign.status === 'SUSPENDED' ? (
        <Text accessibilityRole="alert" style={[styles.warning, { fontSize: m.smallSize }]}>
          {t.suspended}
        </Text>
      ) : null}
      <View style={[styles.row, { gap: m.gap * 0.6 }]}>
        <View accessible accessibilityLabel={`${t.code} : ${data.code}`}>
          <Body muted>{t.code}</Body>
          <Text
            testID="referral-code"
            selectable
            style={[styles.code, fontOf(fonts.title), { fontSize: m.bodySize * 1.4 }]}
          >
            {data.code}
          </Text>
        </View>
        <PanelButton title={copied ? t.copied : t.copy} onPress={() => void copy()} />
        <PanelButton title={t.share} onPress={share} />
      </View>
      {data.links.invite ? (
        <Body muted>
          {t.inviteLink} : <Text selectable>{data.links.invite}</Text>
        </Body>
      ) : (
        <Body muted>{t.noDownloadLink}</Body>
      )}
      <Body muted>{t.manualHint}</Body>
    </Card>
  );
}

function ProgressCard({ data, t }: Part) {
  const m = useLobbyMetrics();
  const { summary, nextTier } = data;
  const stats: [string, string][] = [
    [t.stats.attributed, String(summary.attributed)],
    [t.stats.qualified, String(summary.qualified)],
    [t.stats.tiers, String(summary.tiersReached)],
    [t.stats.credited, t.tokens(summary.tokensCredited)],
  ];
  const perTier = data.campaign.rules.referralsPerTier;
  const done = nextTier ? perTier - Math.min(perTier, nextTier.remaining) : perTier;
  return (
    <Card>
      <View style={[styles.row, { gap: m.gap }]}>
        {stats.map(([label, value]) => (
          <View key={label} style={styles.stat}>
            <Text style={[styles.statValue, { fontSize: m.bodySize * 1.15 }]}>{value}</Text>
            <Body muted>{label}</Body>
          </View>
        ))}
      </View>
      {nextTier ? (
        <>
          <Bar value={done} max={perTier} label={t.next(nextTier.remaining, t.tokens(nextTier.reward), nextTier.tier)} />
          <Body>{t.next(nextTier.remaining, t.tokens(nextTier.reward), nextTier.tier)}</Body>
        </>
      ) : (
        <Body>{t.allTiers}</Body>
      )}
      {data.withheldTiers > 0 ? <Body muted>{t.withheld(data.withheldTiers)}</Body> : null}
      {data.evaluationPending ? <Body muted>{t.pending}</Body> : null}
    </Card>
  );
}

function RefereeList({ data, t }: Part) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  return (
    <Card>
      <Heading>{t.referees}</Heading>
      {data.referees.length === 0 ? (
        <EmptyState glyph="🤝" title={t.empty} size={m.bodySize} fontFamily={fonts.button} />
      ) : (
        data.referees.map((r) => (
          <View key={r.id} testID={`referee-${r.id}`} style={[styles.referee, { gap: m.gap * 0.3 }]}>
            <View style={[styles.row, { gap: m.gap * 0.5 }]}>
              <Text style={[styles.username, { fontSize: m.smallSize * 1.1 }]}>{r.username}</Text>
              <SalonStatusBadge
                label={t.statuses[r.status]}
                tone={STATUS_TONE[r.status]}
                size={Math.round(m.smallSize * 0.9)}
                fontFamily={fonts.button}
              />
            </View>
            {/* Progression individuelle, plafonnée au seuil par le serveur. */}
            <Bar
              value={r.progress}
              max={r.threshold}
              label={t.progress(t.tokens(r.progress), t.tokens(r.threshold))}
            />
            <Body muted>{t.progress(t.tokens(r.progress), t.tokens(r.threshold))}</Body>
          </View>
        ))
      )}
    </Card>
  );
}

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now: Math.min(value, max) }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  code: { color: salon.brass.text, letterSpacing: 3, fontVariant: ['tabular-nums'] },
  warning: { color: gameTheme.focus, fontWeight: '600' },
  error: { color: palette.error },
  stat: { minWidth: 96 },
  statValue: { color: salon.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  referee: {
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: salon.surface.wellBorder,
  },
  username: { color: salon.text, fontWeight: '600' },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: salon.surface.well,
    borderWidth: 1,
    borderColor: salon.surface.wellBorder,
  },
  fill: { height: '100%', backgroundColor: salon.brass.fill },
});
