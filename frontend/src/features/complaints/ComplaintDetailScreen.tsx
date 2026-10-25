import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  fontOf,
  TableBackdrop,
  tablePalette as palette,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { salon } from '../../constants/theme';
import { complaintsApi } from '../../services/complaints-api';
import { useAuthStore } from '../../stores/auth-store';
import { leaveLegalDocument } from '../legal/LegalDocumentScreen';
import { PanelButton } from '../lobby/LobbyUi';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useComplaintMessages } from './complaint-messages';
import { Body, Card, Field, formatDateTime, Heading, StatusBadge } from './ComplaintUi';
import { useComplaint, useComplaintActions } from './hooks';
import { userErrorMessage } from '../../lib/api-client';

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/**
 * Détail d'une réclamation (D-114) : statut et prochaine étape, décision motivée, échanges avec
 * le support, historique, pièces justificatives ; réponse, contestation, acceptation, retrait.
 */
export function ComplaintDetailScreen({ complaintId }: { complaintId: string }) {
  const t = useComplaintMessages();
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const detail = useComplaint(complaintId);
  const actions = useComplaintActions(complaintId);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [reply, setReply] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const data = detail.data;
  const complaint = data?.complaint;
  const busy =
    actions.reply.isPending ||
    actions.reopen.isPending ||
    actions.close.isPending ||
    actions.attach.isPending;
  const error = [actions.reply, actions.reopen, actions.close, actions.attach].find(
    (a) => a.error,
  )?.error;

  const pickAttachment = async () => {
    setNotice(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > MAX_ATTACHMENT_BYTES) {
      setNotice(t.detail.attachHint);
      return;
    }
    actions.attach.mutate(
      { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' },
      { onSuccess: () => setNotice(t.detail.attached) },
    );
  };

  const confirmWithdraw = () =>
    Alert.alert(t.detail.withdraw, t.detail.withdrawConfirm, [
      { text: t.form.cancel, style: 'cancel' },
      {
        text: t.detail.confirm,
        style: 'destructive',
        onPress: () => actions.close.mutate(),
      },
    ]);

  const padding = {
    paddingTop: m.safe.top,
    paddingBottom: m.safe.bottom,
    paddingLeft: m.safe.left,
    paddingRight: m.safe.right,
  };
  const decided = complaint?.status === 'RESOLVED' || complaint?.status === 'REJECTED';
  const active = complaint?.canReply ?? false;

  return (
    <TableBackdrop>
      <View style={[styles.fill, padding, { gap: m.gap * 0.7 }]}>
        <View style={[styles.row, { gap: m.gap }]}>
          <PanelButton
            title={`‹ ${t.back}`}
            accessibilityLabel={t.backA11y}
            onPress={leaveLegalDocument}
          />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.title, fontOf(fonts.title), { fontSize: m.panelTitleSize * 0.7 }]}
          >
            {complaint ? `${complaint.reference} — ${complaint.title}` : t.detail.loading}
          </Text>
        </View>
        {detail.isPending ? <ActivityIndicator color={palette.gold} /> : null}
        {detail.error ? <Text style={styles.error}>{userErrorMessage(detail.error)}</Text> : null}
        {complaint && data ? (
          <ScrollView contentContainerStyle={{ gap: m.gap * 0.7 }}>
            <View style={[styles.row, styles.top, { gap: m.gap * 0.7 }]}>
              <Card style={styles.fill}>
                <Body muted>{t.detail.status}</Body>
                <StatusBadge status={complaint.status} label={t.statuses[complaint.status]} />
                <Body muted>{t.detail.nextStep}</Body>
                <Body>{t.nextSteps[complaint.nextStep]}</Body>
                <Body muted>
                  {t.categories[complaint.category]} ·{' '}
                  {formatDateTime(complaint.createdAt, t.locale)}
                </Body>
              </Card>
              <Card style={styles.fill}>
                <Heading>{t.form.description}</Heading>
                <Body>{complaint.description}</Body>
              </Card>
            </View>

            {complaint.decision ? (
              <Card>
                <Heading>{t.detail.decision}</Heading>
                <Body>{complaint.decision}</Body>
                {complaint.decidedAt ? (
                  <Body muted>{formatDateTime(complaint.decidedAt, t.locale)}</Body>
                ) : null}
              </Card>
            ) : null}

            <Card>
              <Heading>{t.detail.messages}</Heading>
              {data.messages.map((message) => (
                <View key={message.id} style={styles.message}>
                  <Text style={[styles.author, { fontSize: m.smallSize * 0.85 }]}>
                    {message.authorType === 'PLAYER' ? t.assistant.you : t.detail.support} ·{' '}
                    {formatDateTime(message.createdAt, t.locale)}
                  </Text>
                  <Body>{message.body}</Body>
                </View>
              ))}
              {active ? (
                <>
                  <Field
                    value={reply}
                    onChangeText={setReply}
                    placeholder={t.detail.replyPlaceholder}
                    multiline
                    maxLength={4000}
                    accessibilityLabel={t.detail.replyPlaceholder}
                  />
                  <View style={[styles.row, { gap: m.gap * 0.5 }]}>
                    <PanelButton
                      title={t.detail.reply}
                      loading={actions.reply.isPending}
                      disabled={reply.trim().length === 0 || busy}
                      onPress={() =>
                        actions.reply.mutate(reply.trim(), {
                          onSuccess: () => setReply(''),
                        })
                      }
                    />
                    <PanelButton
                      title={t.detail.withdraw}
                      tone="danger"
                      disabled={busy}
                      onPress={confirmWithdraw}
                    />
                  </View>
                </>
              ) : null}
            </Card>

            {decided ? (
              <Card>
                {complaint.canReopen ? (
                  <Field
                    value={reason}
                    onChangeText={setReason}
                    placeholder={t.detail.reopenPlaceholder}
                    multiline
                    maxLength={500}
                    accessibilityLabel={t.detail.reopenPlaceholder}
                  />
                ) : null}
                <View style={[styles.row, { gap: m.gap * 0.5 }]}>
                  {complaint.canReopen ? (
                    <PanelButton
                      title={t.detail.reopen}
                      disabled={reason.trim().length < 5 || busy}
                      loading={actions.reopen.isPending}
                      onPress={() =>
                        actions.reopen.mutate(reason.trim(), {
                          onSuccess: () => setReason(''),
                        })
                      }
                    />
                  ) : null}
                  <PanelButton
                    title={t.detail.accept}
                    disabled={busy}
                    onPress={() => actions.close.mutate()}
                  />
                </View>
              </Card>
            ) : null}

            <Card>
              <Heading>{t.detail.attachments}</Heading>
              <View style={[styles.row, { gap: m.gap * 0.5 }]}>
                {data.attachments.map((attachment) =>
                  attachment.contentType.startsWith('image/') && accessToken ? (
                    <Image
                      key={attachment.id}
                      accessibilityLabel={t.detail.attachments}
                      source={{
                        uri: complaintsApi.attachmentUrl(complaint.id, attachment.id),
                        headers: { Authorization: `Bearer ${accessToken}` },
                      }}
                      style={{
                        width: m.cardWidth,
                        height: m.cardWidth,
                        borderRadius: 6,
                      }}
                    />
                  ) : (
                    <Body key={attachment.id}>📄 PDF</Body>
                  ),
                )}
              </View>
              {complaint.status !== 'CLOSED' ? (
                <>
                  <Body muted>{t.detail.attachHint}</Body>
                  <View style={styles.row}>
                    <PanelButton
                      title={t.detail.attach}
                      loading={actions.attach.isPending}
                      disabled={busy}
                      onPress={() => void pickAttachment()}
                    />
                  </View>
                </>
              ) : null}
              {notice ? <Body>{notice}</Body> : null}
            </Card>

            <Card>
              <Heading>{t.detail.history}</Heading>
              {data.events.map((event) => (
                <Body key={event.id} muted>
                  {formatDateTime(event.createdAt, t.locale)} — {t.events[event.type] ?? event.type}
                  {event.toStatus ? ` → ${t.statuses[event.toStatus]}` : ''}
                </Body>
              ))}
            </Card>
            {error ? <Text style={styles.error}>{userErrorMessage(error)}</Text> : null}
          </ScrollView>
        ) : null}
      </View>
    </TableBackdrop>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  top: { alignItems: 'stretch' },
  title: { flex: 1, color: salon.text, letterSpacing: 1.2, ...titleShadow },
  message: { gap: 2 },
  author: { color: salon.brass.text, fontWeight: '700' },
  error: { color: palette.error },
});
