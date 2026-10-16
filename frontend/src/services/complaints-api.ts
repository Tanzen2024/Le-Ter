import { API_URL, ApiError, apiFetch, apiRequest } from '../lib/api-client';
import type {
  Complaint,
  ComplaintDetail,
  CreateComplaintPayload,
  SupportMessage,
  SupportState,
} from '../types/complaint';

/**
 * Réclamations et assistant automatisé (D-114). L'application ne parle QU'À l'API Le Ter :
 * jamais au fournisseur d'IA (Ollama), dont l'adresse n'est connue que du serveur.
 */
export const complaintsApi = {
  list: (accessToken: string) =>
    apiRequest<{ complaints: Complaint[] }>('/api/complaints', { accessToken }),

  get: (accessToken: string, idOrReference: string) =>
    apiRequest<ComplaintDetail>(`/api/complaints/${encodeURIComponent(idOrReference)}`, {
      accessToken,
    }),

  /** Une clé par intention : un renvoi (coupure, double appui) ne crée pas deux dossiers. */
  create: (accessToken: string, payload: CreateComplaintPayload, idempotencyKey: string) =>
    apiRequest<ComplaintDetail>('/api/complaints', {
      method: 'POST',
      body: payload,
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  reply: (accessToken: string, id: string, body: string, idempotencyKey: string) =>
    apiRequest<{ status: string }>(`/api/complaints/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: { body },
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  reopen: (accessToken: string, id: string, reason: string) =>
    apiRequest<{ status: string }>(`/api/complaints/${encodeURIComponent(id)}/reopen`, {
      method: 'POST',
      body: { reason },
      accessToken,
    }),

  close: (accessToken: string, id: string) =>
    apiRequest<{ status: string }>(`/api/complaints/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      body: {},
      accessToken,
    }),

  /** Pièce justificative : envoi binaire (le serveur vérifie le type sur le contenu). */
  async attach(accessToken: string, id: string, file: { uri: string; mimeType: string }) {
    const blob = await (await fetch(file.uri)).blob();
    const response = await apiFetch(
      `${API_URL}/api/complaints/${encodeURIComponent(id)}/attachments`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': file.mimeType,
          Authorization: `Bearer ${accessToken}`,
        },
        body: blob,
      },
    );
    const data = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new ApiError(
        response.status,
        data.code ?? 'HTTP_ERROR',
        data.message ?? 'Envoi impossible. Réessayez.',
      );
    }
    return data;
  },

  /** Adresse d'une pièce, lisible avec l'en-tête d'authentification du joueur. */
  attachmentUrl: (id: string, attachmentId: string) =>
    `${API_URL}/api/complaints/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,

  assistant: (accessToken: string) =>
    apiRequest<{ mode: 'AI' | 'DEGRADED' }>('/api/support/assistant', {
      accessToken,
    }),

  current: (accessToken: string) =>
    apiRequest<SupportState>('/api/support/conversations/current', {
      accessToken,
    }),

  start: (accessToken: string, language: 'fr' | 'en') =>
    apiRequest<SupportState>('/api/support/conversations', {
      method: 'POST',
      body: { language },
      accessToken,
    }),

  reset: (accessToken: string, language: 'fr' | 'en') =>
    apiRequest<SupportState>('/api/support/conversations/reset', {
      method: 'POST',
      body: { language },
      accessToken,
    }),

  send: (
    accessToken: string,
    conversationId: string,
    content: string,
    language: 'fr' | 'en',
    idempotencyKey: string,
  ) =>
    apiRequest<{
      playerMessage: SupportMessage;
      assistantMessage: SupportMessage;
    }>(`/api/support/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: { content, language },
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};
