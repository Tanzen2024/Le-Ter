import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  fontOf,
  TableBackdrop,
  tablePalette as palette,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { EmptyState } from '../../components/ui/SalonParts';
import { salon } from '../../constants/theme';
import type { ComplaintDraft } from '../../types/complaint';
import { leaveLegalDocument } from '../legal/LegalDocumentScreen';
import { PanelButton } from '../lobby/LobbyUi';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { ReferralSection } from '../referrals/ReferralSection';
import { useReferralMessages } from '../referrals/referral-messages';
import { AssistantChat } from './AssistantChat';
import { ComplaintForm } from './ComplaintForm';
import { useComplaintMessages } from './complaint-messages';
import { Body, Card, formatDateTime, StatusBadge } from './ComplaintUi';
import { useComplaints } from './hooks';
import { shortcutDraft } from './shortcut-draft';
import { userErrorMessage } from '../../lib/api-client';

type Tab = 'assistant' | 'complaints' | 'referral';

const TABS: readonly Tab[] = ['assistant', 'complaints', 'referral'];

/**
 * « Aide et réclamations » (D-114) : l'assistant automatisé, la liste des réclamations du
 * joueur et le dépôt d'une réclamation officielle (toujours possible, même sans assistant).
 * Onglet Parrainage (D-161) permanent : `?tab=referral` l'ouvre directement.
 */
export function SupportScreen() {
  const t = useComplaintMessages();
  const referral = useReferralMessages();
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const params = useLocalSearchParams<{
    tab?: string;
    gameId?: string;
    tournamentId?: string;
    category?: string;
  }>();
  const [tab, setTab] = useState<Tab>(
    params.tab === 'complaints' || params.tab === 'referral' ? params.tab : 'assistant',
  );
  // Ouvert depuis une partie ou un tournoi : le formulaire part de ce contexte (vérifié au dépôt).
  const [form, setForm] = useState<{
    draft: ComplaintDraft | null;
    conversationId: string | null;
  } | null>(() => {
    const draft = shortcutDraft(params, (category) => t.categories[category]);
    return draft ? { draft, conversationId: null } : null;
  });
  const [created, setCreated] = useState<string | null>(null);

  const padding = {
    paddingTop: m.safe.top,
    paddingBottom: m.safe.bottom,
    paddingLeft: m.safe.left,
    paddingRight: m.safe.right,
  };

  return (
    <TableBackdrop>
      <View style={[styles.fill, padding, { gap: m.gap * 0.7 }]}>
        <View style={[styles.header, { gap: m.gap }]}>
          <PanelButton
            title={`‹ ${t.back}`}
            accessibilityLabel={t.backA11y}
            onPress={leaveLegalDocument}
          />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.title, fontOf(fonts.title), { fontSize: m.panelTitleSize * 0.75 }]}
          >
            {t.title}
          </Text>
          <View style={[styles.tabs, { gap: m.gap * 0.4 }]} accessibilityRole="tablist">
            {TABS.map((value) => (
              <PanelButton
                key={value}
                title={value === 'referral' ? referral.tab : t.tabs[value]}
                selected={tab === value}
                onPress={() => {
                  setForm(null);
                  setTab(value);
                }}
              />
            ))}
          </View>
        </View>
        <View style={styles.fill}>
          {form ? (
            <ComplaintForm
              draft={form.draft}
              conversationId={form.conversationId}
              onCancel={() => setForm(null)}
              onCreated={(id, reference) => {
                setForm(null);
                setCreated(reference);
                setTab('complaints');
                router.push(`/support/${id}`);
              }}
            />
          ) : tab === 'referral' ? (
            <ReferralSection />
          ) : tab === 'assistant' ? (
            <AssistantChat
              onFileComplaint={(draft, conversationId) => setForm({ draft, conversationId })}
            />
          ) : (
            <ComplaintList
              created={created}
              onNew={() => setForm({ draft: null, conversationId: null })}
            />
          )}
        </View>
      </View>
    </TableBackdrop>
  );
}

function ComplaintList({ created, onNew }: { created: string | null; onNew: () => void }) {
  const t = useComplaintMessages();
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const complaints = useComplaints();
  return (
    <View style={[styles.fill, { gap: m.gap * 0.6 }]}>
      <View style={[styles.header, { gap: m.gap * 0.5 }]}>
        <PanelButton title={t.list.new} onPress={onNew} />
        <PanelButton title={t.list.refresh} onPress={() => void complaints.refetch()} />
      </View>
      {created ? <Body>{t.form.created(created)}</Body> : null}
      {complaints.isPending ? <ActivityIndicator color={palette.gold} /> : null}
      {complaints.error ? <Text style={styles.error}>{userErrorMessage(complaints.error)}</Text> : null}
      <ScrollView contentContainerStyle={{ gap: m.gap * 0.5 }}>
        {complaints.data?.length === 0 ? (
          <EmptyState glyph="🛟" title={t.list.empty} size={m.bodySize} fontFamily={fonts.button} />
        ) : null}
        {complaints.data?.map((complaint) => (
          <Pressable
            key={complaint.id}
            accessibilityRole="button"
            accessibilityLabel={`${complaint.reference}, ${t.statuses[complaint.status]}`}
            onPress={() => router.push(`/support/${complaint.id}`)}
          >
            <Card>
              <View style={[styles.header, { gap: m.gap * 0.5 }]}>
                <Text style={[styles.reference, { fontSize: m.smallSize }]}>
                  {complaint.reference}
                </Text>
                <StatusBadge status={complaint.status} label={t.statuses[complaint.status]} />
              </View>
              <Body>{complaint.title}</Body>
              <Body muted>
                {t.categories[complaint.category]} · {formatDateTime(complaint.updatedAt, t.locale)}
              </Body>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  tabs: { flexDirection: 'row' },
  title: { flex: 1, color: salon.text, letterSpacing: 1.2, ...titleShadow },
  reference: { color: salon.brass.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  error: { color: palette.error },
});
