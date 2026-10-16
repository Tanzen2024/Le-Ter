import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useRef } from 'react';

import { useLanguage } from '../../lib/i18n';
import { complaintsApi } from '../../services/complaints-api';
import { useAuthStore } from '../../stores/auth-store';
import type { CreateComplaintPayload, SupportState } from '../../types/complaint';
import { withAccessToken } from '../auth/session';

export const complaintKeys = {
  list: ['complaints', 'list'] as const,
  detail: (id: string) => ['complaints', 'detail', id] as const,
  conversation: ['support', 'conversation'] as const,
  assistant: ['support', 'assistant'] as const,
};

function useSignedIn() {
  return useAuthStore((s) => s.status) === 'signedIn';
}

export function useComplaints() {
  return useQuery({
    queryKey: complaintKeys.list,
    queryFn: async () => (await withAccessToken((t) => complaintsApi.list(t))).complaints,
    enabled: useSignedIn(),
  });
}

export function useComplaint(id: string) {
  return useQuery({
    queryKey: complaintKeys.detail(id),
    queryFn: () => withAccessToken((t) => complaintsApi.get(t, id)),
    enabled: useSignedIn() && id.length > 0,
    // Le support peut répondre à tout moment : relu régulièrement tant que l'écran est ouvert.
    refetchInterval: 30_000,
  });
}

export function useAssistantStatus() {
  return useQuery({
    queryKey: complaintKeys.assistant,
    queryFn: () => withAccessToken((t) => complaintsApi.assistant(t)),
    enabled: useSignedIn(),
    staleTime: 30_000,
  });
}

export function useConversation() {
  return useQuery({
    queryKey: complaintKeys.conversation,
    queryFn: () => withAccessToken((t) => complaintsApi.current(t)),
    enabled: useSignedIn(),
  });
}

export function useStartConversation() {
  const queryClient = useQueryClient();
  const language = useLanguage();
  return useMutation({
    mutationFn: (reset: boolean) =>
      withAccessToken((t) =>
        reset ? complaintsApi.reset(t, language) : complaintsApi.start(t, language),
      ),
    onSuccess: (state) => queryClient.setQueryData(complaintKeys.conversation, state),
  });
}

/**
 * Message à l'assistant. La clé d'idempotence est gardée tant que l'envoi n'a pas abouti : un
 * nouvel essai après une coupure renvoie le même échange, sans second appel au modèle.
 */
export function useSendToAssistant() {
  const queryClient = useQueryClient();
  const language = useLanguage();
  const pending = useRef<{ content: string; key: string } | null>(null);
  return useMutation({
    mutationFn: ({ conversationId, content }: { conversationId: string; content: string }) => {
      if (!pending.current || pending.current.content !== content) {
        pending.current = { content, key: randomUUID() };
      }
      const key = pending.current.key;
      return withAccessToken((t) => complaintsApi.send(t, conversationId, content, language, key));
    },
    onSuccess: ({ playerMessage, assistantMessage }) => {
      pending.current = null;
      queryClient.setQueryData<SupportState>(complaintKeys.conversation, (state) =>
        state
          ? {
              ...state,
              conversation: state.conversation && {
                ...state.conversation,
                playerTurns: state.conversation.playerTurns + 1,
              },
              messages: [
                ...state.messages.filter(
                  (m) => m.id !== playerMessage.id && m.id !== assistantMessage.id,
                ),
                playerMessage,
                assistantMessage,
              ],
            }
          : state,
      );
    },
  });
}

export function useCreateComplaint() {
  const queryClient = useQueryClient();
  const key = useRef<string>(randomUUID());
  return useMutation({
    mutationFn: (payload: CreateComplaintPayload) =>
      withAccessToken((t) => complaintsApi.create(t, payload, key.current)),
    onSuccess: (detail) => {
      key.current = randomUUID();
      queryClient.setQueryData(complaintKeys.detail(detail.complaint.id), detail);
      void queryClient.invalidateQueries({ queryKey: complaintKeys.list });
    },
  });
}

/** Actions sur un dossier : chaque succès relit le dossier et la liste (source : le serveur). */
export function useComplaintActions(id: string) {
  const queryClient = useQueryClient();
  const replyKey = useRef<string>(randomUUID());
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: complaintKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: complaintKeys.list });
  };
  return {
    reply: useMutation({
      mutationFn: (body: string) =>
        withAccessToken((t) => complaintsApi.reply(t, id, body, replyKey.current)),
      onSuccess: () => {
        replyKey.current = randomUUID();
        refresh();
      },
    }),
    reopen: useMutation({
      mutationFn: (reason: string) => withAccessToken((t) => complaintsApi.reopen(t, id, reason)),
      onSuccess: refresh,
    }),
    close: useMutation({
      mutationFn: () => withAccessToken((t) => complaintsApi.close(t, id)),
      onSuccess: refresh,
    }),
    attach: useMutation({
      mutationFn: (file: { uri: string; mimeType: string }) =>
        withAccessToken((t) => complaintsApi.attach(t, id, file)),
      onSuccess: refresh,
    }),
  };
}
