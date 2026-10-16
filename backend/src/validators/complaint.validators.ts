import type { AssistantLanguage } from '../domain/complaints/assistant';
import {
  COMPLAINT_LIMITS,
  isComplaintCategory,
  isComplaintPriority,
  isComplaintStatus,
  type ComplaintCategory,
  type ComplaintLinks,
  type ComplaintPriority,
  type ComplaintStatus,
} from '../domain/complaints/complaint';
import type { UserId } from '../domain/users/user';
import type { AdminComplaintFilters } from '../repositories/complaint.repository';
import type { CreateComplaintInput } from '../services/complaints/complaint.service';
import { ValidationError } from './validation-error';

/**
 * Validation des entrées des réclamations et de l'assistant (D-114). Aucun champ d'identité
 * n'est lu : `userId`, `playerId`, `role`… envoyés par le client sont ignorés ; l'auteur est
 * toujours le titulaire du jeton vérifié.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Caractères de contrôle (hors saut de ligne et tabulation) : refusés. */
function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) return true;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(
  fields: Record<string, string>,
  name: string,
  value: unknown,
  min: number,
  max: number,
  label: string,
): string {
  if (typeof value !== 'string') {
    fields[name] = `${label} requis.`;
    return '';
  }
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (hasControlCharacter(normalized)) {
    fields[name] = `${label} contient des caractères non autorisés.`;
  } else if (normalized.length < min || normalized.length > max) {
    fields[name] = `${label} : entre ${min} et ${max} caractères.`;
  }
  return normalized;
}

function uuid(fields: Record<string, string>, name: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !UUID.test(value)) {
    fields[name] = 'Identifiant invalide.';
    return undefined;
  }
  return value.toLowerCase();
}

function done(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
}

export function parseLanguage(value: unknown): AssistantLanguage {
  return value === 'en' ? 'en' : 'fr';
}

export function parseCreateComplaint(body: unknown): CreateComplaintInput {
  const b = asRecord(body);
  const fields: Record<string, string> = {};
  if (!isComplaintCategory(b.category)) fields.category = 'Catégorie invalide.';
  const title = text(
    fields,
    'title',
    b.title,
    COMPLAINT_LIMITS.titleMin,
    COMPLAINT_LIMITS.titleMax,
    'Titre',
  );
  const description = text(
    fields,
    'description',
    b.description,
    COMPLAINT_LIMITS.descriptionMin,
    COMPLAINT_LIMITS.descriptionMax,
    'Description',
  );
  const linksIn = asRecord(b.links);
  const links: ComplaintLinks = {};
  for (const name of [
    'gameId',
    'tournamentId',
    'walletTransactionId',
    'paymentId',
    'withdrawalId',
  ] as const) {
    const value = uuid(fields, `links.${name}`, linksIn[name]);
    if (value) links[name] = value;
  }
  const conversationId = uuid(fields, 'conversationId', b.conversationId);
  let incidentAt: Date | undefined;
  if (b.incidentAt !== undefined && b.incidentAt !== null && b.incidentAt !== '') {
    const parsed = typeof b.incidentAt === 'string' ? new Date(b.incidentAt) : new Date(NaN);
    if (Number.isNaN(parsed.getTime())) fields.incidentAt = 'Date invalide.';
    else incidentAt = parsed;
  }
  done(fields);
  return {
    category: b.category as ComplaintCategory,
    title,
    description,
    links,
    ...(incidentAt && { incidentAt }),
    ...(conversationId && { conversationId }),
  };
}

export function parseMessageBody(body: unknown, field = 'body'): string {
  const fields: Record<string, string> = {};
  const value = text(
    fields,
    field,
    asRecord(body)[field],
    1,
    COMPLAINT_LIMITS.messageMax,
    'Message',
  );
  done(fields);
  return value;
}

export function parseReason(body: unknown): string {
  const fields: Record<string, string> = {};
  const value = text(
    fields,
    'reason',
    asRecord(body).reason,
    5,
    COMPLAINT_LIMITS.reasonMax,
    'Motif',
  );
  done(fields);
  return value;
}

export function parseAssistantMessage(body: unknown): {
  content: string;
  language: AssistantLanguage;
} {
  const b = asRecord(body);
  const fields: Record<string, string> = {};
  const content = text(fields, 'content', b.content, 1, 1000, 'Message');
  done(fields);
  return { content, language: parseLanguage(b.language) };
}

export function parseAdminReply(body: unknown): { body: string; internal: boolean } {
  const b = asRecord(body);
  return { body: parseMessageBody(b), internal: b.internal === true };
}

export function parseStatusChange(body: unknown): {
  status: ComplaintStatus;
  expectedStatus?: ComplaintStatus;
  decision?: string;
  reason?: string;
} {
  const b = asRecord(body);
  const fields: Record<string, string> = {};
  if (!isComplaintStatus(b.status)) fields.status = 'Statut invalide.';
  if (b.expectedStatus !== undefined && !isComplaintStatus(b.expectedStatus)) {
    fields.expectedStatus = 'Statut attendu invalide.';
  }
  const deciding = b.status === 'RESOLVED' || b.status === 'REJECTED';
  const decision = deciding
    ? text(
        fields,
        'decision',
        b.decision,
        COMPLAINT_LIMITS.decisionMin,
        COMPLAINT_LIMITS.decisionMax,
        'Décision motivée',
      )
    : undefined;
  const reason =
    b.reason === undefined || b.reason === ''
      ? undefined
      : text(fields, 'reason', b.reason, 1, COMPLAINT_LIMITS.reasonMax, 'Motif');
  done(fields);
  return {
    status: b.status as ComplaintStatus,
    ...(b.expectedStatus !== undefined && { expectedStatus: b.expectedStatus as ComplaintStatus }),
    ...(decision !== undefined && { decision }),
    ...(reason !== undefined && { reason }),
  };
}

export function parseRequestInfo(body: unknown): {
  message: string;
  expectedStatus?: ComplaintStatus;
} {
  const b = asRecord(body);
  const message = parseMessageBody(b, 'message');
  if (b.expectedStatus !== undefined && !isComplaintStatus(b.expectedStatus)) {
    throw new ValidationError({ expectedStatus: 'Statut attendu invalide.' });
  }
  return {
    message,
    ...(b.expectedStatus !== undefined && { expectedStatus: b.expectedStatus as ComplaintStatus }),
  };
}

export function parseAssignee(body: unknown): UserId | null {
  const value = asRecord(body).assigneeId;
  if (value === null) return null;
  const fields: Record<string, string> = {};
  const id = uuid(fields, 'assigneeId', value);
  if (!id) fields.assigneeId ??= 'Administrateur requis (ou null pour retirer l’assignation).';
  done(fields);
  return id as UserId;
}

export function parsePriority(body: unknown): ComplaintPriority {
  const value = asRecord(body).priority;
  if (!isComplaintPriority(value)) throw new ValidationError({ priority: 'Priorité invalide.' });
  return value;
}

export function parseAdminComplaintQuery(query: unknown): AdminComplaintFilters {
  const q = asRecord(query);
  const fields: Record<string, string> = {};
  const int = (name: string, fallback: number, max: number) => {
    if (q[name] === undefined) return fallback;
    const parsed = Number(q[name]);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      fields[name] = `Entier entre 1 et ${max} attendu.`;
      return fallback;
    }
    return parsed;
  };
  const date = (name: string) => {
    if (q[name] === undefined || q[name] === '') return undefined;
    const parsed = new Date(String(q[name]));
    if (Number.isNaN(parsed.getTime())) {
      fields[name] = 'Date invalide.';
      return undefined;
    }
    return parsed;
  };
  const filters: AdminComplaintFilters = {
    page: int('page', 1, 10_000),
    limit: int('limit', 25, 100),
  };
  if (q.status !== undefined && q.status !== '') {
    if (isComplaintStatus(q.status)) filters.status = q.status;
    else fields.status = 'Statut invalide.';
  }
  if (q.category !== undefined && q.category !== '') {
    if (isComplaintCategory(q.category)) filters.category = q.category;
    else fields.category = 'Catégorie invalide.';
  }
  if (q.priority !== undefined && q.priority !== '') {
    if (isComplaintPriority(q.priority)) filters.priority = q.priority;
    else fields.priority = 'Priorité invalide.';
  }
  if (typeof q.player === 'string' && q.player.trim() !== '')
    filters.player = q.player.trim().slice(0, 64);
  if (typeof q.reference === 'string' && q.reference.trim() !== '') {
    filters.reference = q.reference.trim().slice(0, 32);
  }
  if (q.assignee === 'none') filters.assignee = 'none';
  else if (q.assignee !== undefined && q.assignee !== '') {
    const id = uuid(fields, 'assignee', q.assignee);
    if (id) filters.assignee = id as UserId;
  }
  const from = date('from');
  const to = date('to');
  if (from) filters.from = from;
  if (to) filters.to = to;
  done(fields);
  return filters;
}
