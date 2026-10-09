import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import type { RealtimeStatus } from '../../lib/realtime-client';
import type { ChatMessage } from '../../types/chat';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useAppear, useBackToClose } from '../games/table/GameOverlays';

export interface ChatPanelProps {
  /** Bords du panneau sans clavier (la table reste visible à gauche). */
  top: number;
  bottom: number;
  onClose: () => void;
  /** Joueur connecté : ses messages sont alignés à droite. */
  myId: string | undefined;
  messages: readonly ChatMessage[];
  loading: boolean;
  loadError?: string;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Faux : partie terminée, historique en lecture seule (décision du serveur). */
  canSend: boolean;
  /** Limite du serveur ; absente tant que l'historique n'est pas chargé. */
  maxLength?: number;
  connection: RealtimeStatus;
  sending: boolean;
  sendError?: string;
  /** `onSent` : appelé seulement après la confirmation du serveur. */
  onSend: (content: string, onSent: () => void) => void;
  onDraftChange?: () => void;
}

/** Heure locale « HH:MM » d'un message (date du serveur). */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Haut du clavier (coordonnées écran), ou `null` s'il est fermé. */
function useKeyboardTop(): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setTop(e.endCoordinates.screenY));
    const hide = Keyboard.addListener(hideEvent, () => setTop(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return top;
}

/**
 * Chat de la partie (D-045) : panneau latéral compact, sans voile, la table reste visible et
 * jouable à gauche. Les messages sont affichés comme du TEXTE (jamais interprétés), et seul
 * le serveur les fournit : rien n'est ajouté localement avant sa confirmation.
 */
export function ChatPanel(props: ChatPanelProps) {
  const { top, bottom, onClose, messages, myId, canSend, maxLength, sending } = props;
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const appear = useAppear();
  const window = useWindowDimensions();
  const keyboardTop = useKeyboardTop();
  const [draft, setDraft] = useState('');
  useBackToClose(onClose);

  const width = Math.round(Math.min(Math.max(m.width * 0.3, 220), 340));
  // Clavier ouvert : le panneau remonte au-dessus de lui et s'étend vers le haut. Si la
  // fenêtre est déjà redimensionnée par le système, l'écart calculé est nul (aucun double décalage).
  const keyboardBottom =
    keyboardTop === null ? 0 : Math.max(0, window.height - keyboardTop) + m.gap * 0.5;
  const panelBottom = Math.max(bottom, keyboardBottom);
  const panelTop = keyboardTop === null ? top : Math.min(top, m.safe.top + m.gap * 0.5);

  const reversed = useMemo(() => [...messages].reverse(), [messages]);
  const content = draft.trim();
  const tooLong = maxLength !== undefined && [...content].length > maxLength;
  const canSubmit = canSend && content.length > 0 && !tooLong && !sending;
  const submit = () => {
    if (!canSubmit) return;
    props.onSend(content, () => setDraft(''));
  };

  const small = { fontSize: m.smallSize };
  return (
    <Animated.View
      accessibilityViewIsModal={false}
      accessibilityLabel="Chat de la partie"
      style={[
        styles.panel,
        {
          top: panelTop,
          bottom: panelBottom,
          right: m.safe.right,
          width,
          padding: m.gap,
          gap: m.gap * 0.6,
          opacity: appear,
          transform: [
            { translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, fontOf(fonts.button), { fontSize: m.bodySize * 1.15 }]}>
          Chat
        </Text>
        {props.connection === 'offline' || props.connection === 'connecting' ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.connection, { fontSize: m.smallSize * 0.9 }]}
          >
            Reconnexion…
          </Text>
        ) : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fermer le chat"
          hitSlop={12}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {props.loading ? (
          <ActivityIndicator testID="chat-loading" color={palette.gold} style={styles.center} />
        ) : props.loadError && messages.length === 0 ? (
          <Text accessibilityRole="alert" style={[styles.empty, small]}>
            {props.loadError}
          </Text>
        ) : messages.length === 0 ? (
          <Text style={[styles.empty, small]}>Aucun message pour l’instant.</Text>
        ) : (
          <FlatList
            testID="chat-messages"
            inverted
            data={reversed}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            onEndReached={() => {
              if (props.hasMore) props.onLoadOlder();
            }}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              props.loadingOlder ? <ActivityIndicator color={palette.gold} /> : null
            }
            contentContainerStyle={{ gap: m.gap * 0.5, paddingVertical: m.gap * 0.3 }}
            renderItem={({ item }) => (
              <Bubble message={item} mine={item.senderId === myId} fontSize={m.smallSize} />
            )}
          />
        )}
      </View>

      {props.sendError ? (
        <Text accessibilityRole="alert" style={[styles.error, small]}>
          {props.sendError}
        </Text>
      ) : null}
      {canSend ? (
        <View style={[styles.composer, { gap: m.gap * 0.5 }]}>
          <TextInput
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              props.onDraftChange?.();
            }}
            placeholder="Écrire…"
            placeholderTextColor="rgba(255, 255, 255, 0.45)"
            accessibilityLabel="Message"
            maxLength={maxLength}
            multiline={false}
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={submit}
            style={[
              styles.input,
              { height: Math.max(40, m.controlHeight * 0.8), fontSize: m.smallSize },
            ]}
          />
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Envoyer"
            accessibilityState={{ disabled: !canSubmit, busy: sending }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.send,
              { width: Math.max(40, m.controlHeight * 0.8), height: Math.max(40, m.controlHeight * 0.8) },
              !canSubmit && styles.sendDisabled,
              pressed && styles.pressed,
            ]}
          >
            {sending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text allowFontScaling={false} style={styles.sendGlyph}>
                ➤
              </Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.closed, small]}>Partie terminée : le chat est en lecture seule.</Text>
      )}
    </Animated.View>
  );
}

/** Bulle de message : le contenu est rendu par <Text>, donc jamais interprété (HTML, liens…). */
function Bubble({
  message,
  mine,
  fontSize,
}: {
  message: ChatMessage;
  mine: boolean;
  fontSize: number;
}) {
  return (
    <View
      testID={mine ? 'chat-bubble-mine' : 'chat-bubble-other'}
      style={[styles.bubble, mine ? styles.mine : styles.other]}
    >
      {mine ? null : (
        <Text numberOfLines={1} style={[styles.sender, { fontSize: fontSize * 0.85 }]}>
          {message.senderDisplayName}
        </Text>
      )}
      <Text selectable style={[styles.text, { fontSize }]}>
        {message.content}
      </Text>
      <Text style={[styles.time, { fontSize: fontSize * 0.75 }]}>
        {formatTime(message.createdAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  panel: {
    position: 'absolute',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(6, 26, 12, 0.78)',
    boxShadow: '0 8px 22px rgba(0, 0, 0, 0.3)',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#FFFFFF', flex: 1 },
  connection: { color: palette.gold, opacity: 0.85 },
  close: { padding: 4 },
  closeText: { color: 'rgba(255, 255, 255, 0.75)', fontSize: 16, fontWeight: '700' },
  body: { flex: 1, minHeight: 0, justifyContent: 'center' },
  center: { alignSelf: 'center' },
  empty: { color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center' },
  bubble: {
    maxWidth: '86%',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 2,
  },
  mine: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
    backgroundColor: 'rgba(30, 144, 100, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.35)',
  },
  other: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  sender: { color: palette.gold, fontWeight: '700' },
  text: { color: '#FFFFFF' },
  time: { color: 'rgba(255, 255, 255, 0.55)', alignSelf: 'flex-end' },
  error: { color: palette.error, fontWeight: '600', textAlign: 'center' },
  closed: { color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', fontStyle: 'italic' },
  composer: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 0,
    color: '#FFFFFF',
  },
  send: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.35)',
    backgroundColor: palette.jade,
    experimental_backgroundImage: 'linear-gradient(180deg, #2FB27A 0%, #1E9064 60%, #157150 100%)',
  },
  sendDisabled: { opacity: 0.45 },
  sendGlyph: { color: '#FFD84A', fontSize: 18, fontWeight: '900' },
});
