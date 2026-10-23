import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { tablePalette as palette } from '../../components/table/TableDecor';
import { userErrorMessage } from '../../lib/api-client';
import type { ComplaintDraft, SupportMessage } from '../../types/complaint';
import { PanelButton } from '../lobby/LobbyUi';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useComplaintMessages } from './complaint-messages';
import { Body, Card, Field } from './ComplaintUi';
import {
  useAssistantStatus,
  useConversation,
  useSendToAssistant,
  useStartConversation,
} from './hooks';

/**
 * Conversation avec l'assistant AUTOMATISÉ (D-114). Les faits vérifiés par le serveur sont
 * affichés à part du texte de l'assistant ; une réclamation se dépose en un appui, avec la
 * catégorie proposée que le joueur peut corriger.
 */
export function AssistantChat({
  onFileComplaint,
}: {
  onFileComplaint: (draft: ComplaintDraft | null, conversationId: string | null) => void;
}) {
  const t = useComplaintMessages();
  const m = useLobbyMetrics();
  const status = useAssistantStatus();
  const conversation = useConversation();
  const start = useStartConversation();
  const send = useSendToAssistant();
  const [text, setText] = useState('');
  const scroll = useRef<ScrollView>(null);

  const state = conversation.data;
  const conversationId = state?.conversation?.id ?? null;
  const messages = state?.messages ?? [];
  const lastDraft = [...messages].reverse().find((msg) => msg.meta?.draft)?.meta?.draft ?? null;
  const degraded = status.data?.mode === 'DEGRADED';

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [messages.length, send.isPending]);

  const submit = () => {
    const content = text.trim();
    if (!content || !conversationId) return;
    send.mutate({ conversationId, content }, { onSuccess: () => setText('') });
  };

  return (
    <View style={[styles.fill, { gap: m.gap * 0.6 }]}>
      <Card>
        <Body>{t.assistant.disclaimer}</Body>
        {degraded ? <Body style={styles.warning}>{t.assistant.degraded}</Body> : null}
      </Card>
      {conversation.isPending ? <ActivityIndicator color={palette.gold} /> : null}
      {!conversation.isPending && !conversationId ? (
        <View style={styles.center}>
          <PanelButton
            title={t.assistant.start}
            loading={start.isPending}
            onPress={() => start.mutate(false)}
          />
        </View>
      ) : null}
      {conversationId ? (
        <>
          <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={{ gap: m.gap * 0.6 }}>
            {messages.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
            {send.isPending ? <Body muted>{t.assistant.thinking}</Body> : null}
            {send.error ? (
              <Text style={styles.error}>
                {userErrorMessage(send.error)}
              </Text>
            ) : null}
          </ScrollView>
          <View style={[styles.row, { gap: m.gap * 0.5 }]}>
            <View style={styles.fill}>
              <Field
                value={text}
                onChangeText={setText}
                placeholder={t.assistant.placeholder}
                maxLength={1000}
                accessibilityLabel={t.assistant.placeholder}
              />
            </View>
            <PanelButton
              title={t.assistant.send}
              accessibilityLabel={t.assistant.sendA11y}
              loading={send.isPending}
              disabled={text.trim().length === 0}
              onPress={submit}
            />
          </View>
          <View style={[styles.row, { gap: m.gap * 0.5 }]}>
            <PanelButton
              title={
                lastDraft?.recommended ? t.assistant.fileRecommended : t.assistant.fileComplaint
              }
              onPress={() => onFileComplaint(lastDraft, conversationId)}
            />
            <PanelButton title={t.assistant.newConversation} onPress={() => start.mutate(true)} />
          </View>
        </>
      ) : null}
    </View>
  );
}

function Bubble({ message }: { message: SupportMessage }) {
  const t = useComplaintMessages();
  const m = useLobbyMetrics();
  const mine = message.role === 'PLAYER';
  const verified = message.meta?.verified ?? [];
  return (
    <View
      style={[
        styles.bubble,
        mine ? styles.mine : styles.theirs,
        { padding: m.gap * 0.6, gap: m.gap * 0.3 },
      ]}
      accessibilityLabel={`${mine ? t.assistant.you : t.assistant.bot} : ${message.content}`}
    >
      <Text style={[styles.author, { fontSize: m.smallSize * 0.85 }]}>
        {mine ? t.assistant.you : `🤖 ${t.assistant.bot}`}
      </Text>
      <Text style={[styles.content, { fontSize: m.smallSize * 1.05 }]}>{message.content}</Text>
      {verified.length > 0 ? (
        <View style={[styles.verified, { padding: m.gap * 0.4 }]}>
          <Text style={[styles.verifiedTitle, { fontSize: m.smallSize * 0.85 }]}>
            ✔ {t.assistant.verified}
          </Text>
          {verified.map((line, index) => (
            <Text key={index} style={[styles.content, { fontSize: m.smallSize }]}>
              • {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  warning: { color: palette.gold },
  error: { color: palette.error },
  bubble: { borderRadius: 10, maxWidth: '88%' },
  mine: { alignSelf: 'flex-end', backgroundColor: palette.jade },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.panelBorder,
  },
  author: { color: palette.gold, fontWeight: '700' },
  content: { color: palette.cream },
  verified: {
    borderRadius: 6,
    backgroundColor: 'rgba(31, 156, 156, 0.18)',
    gap: 2,
  },
  verifiedTitle: { color: palette.teal, fontWeight: '700' },
});
