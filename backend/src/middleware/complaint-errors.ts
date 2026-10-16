import { STATUS_CODES } from 'node:http';

import type { ErrorRequestHandler } from 'express';

import {
  AttachmentRejectedError,
  ComplaintConflictError,
  ComplaintLimitError,
  ComplaintLinkError,
  ComplaintNotFoundError,
  InvalidComplaintTransitionError,
  NotAnAdministratorError,
} from '../domain/complaints/complaint';
import { ConversationNotFoundError } from '../services/complaints/support-assistant.service';

function body(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: STATUS_CODES[status] ?? 'Error', code, message, ...extra };
}

const LIMIT_MESSAGES: Record<ComplaintLimitError['limit'], [string, string]> = {
  ACTIVE_COMPLAINTS: [
    'TOO_MANY_ACTIVE_COMPLAINTS',
    'Vous avez déjà trop de réclamations en cours.',
  ],
  ATTACHMENTS: ['TOO_MANY_ATTACHMENTS', 'Nombre maximal de pièces justificatives atteint.'],
  REOPENS: [
    'REOPEN_LIMIT_REACHED',
    'Cette décision a déjà été contestée le nombre maximal de fois.',
  ],
  REOPEN_WINDOW: [
    'REOPEN_WINDOW_EXPIRED',
    'Le délai de contestation de cette décision est dépassé.',
  ],
};

/**
 * Erreurs des réclamations (D-114), traduites au niveau des routeurs concernés : statut,
 * `code` stable et message fixe. Les autres erreurs suivent le gestionnaire global.
 */
export const complaintErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof ComplaintNotFoundError) {
    res.status(404).json(body(404, 'COMPLAINT_NOT_FOUND', 'Réclamation introuvable.'));
  } else if (err instanceof ConversationNotFoundError) {
    res.status(404).json(body(404, 'CONVERSATION_NOT_FOUND', 'Conversation introuvable.'));
  } else if (err instanceof ComplaintConflictError) {
    res.status(409).json(
      body(409, 'COMPLAINT_CONFLICT', 'Le dossier a été modifié entre-temps. Rechargez-le.', {
        details: { currentStatus: err.current },
      }),
    );
  } else if (err instanceof InvalidComplaintTransitionError) {
    res.status(409).json(
      body(
        409,
        'INVALID_COMPLAINT_TRANSITION',
        'Cette action n’est pas possible dans l’état actuel du dossier.',
        {
          details: { from: err.from, to: err.to },
        },
      ),
    );
  } else if (err instanceof ComplaintLimitError) {
    const [code, message] = LIMIT_MESSAGES[err.limit];
    res.status(409).json(body(409, code, message));
  } else if (err instanceof ComplaintLinkError) {
    res.status(422).json(
      body(422, 'COMPLAINT_LINK_INVALID', 'Élément introuvable parmi les vôtres.', {
        fields: { [err.field]: 'Élément introuvable parmi les vôtres.' },
      }),
    );
  } else if (err instanceof AttachmentRejectedError) {
    if (err.reason === 'EMPTY') {
      res.status(400).json(body(400, 'ATTACHMENT_EMPTY', 'Le fichier envoyé est vide.'));
    } else if (err.reason === 'SIZE') {
      res
        .status(413)
        .json(body(413, 'ATTACHMENT_TOO_LARGE', 'Fichier trop volumineux (3 Mo maximum).'));
    } else if (err.reason === 'TYPE') {
      res
        .status(415)
        .json(body(415, 'ATTACHMENT_TYPE_REJECTED', 'Formats acceptés : JPEG, PNG, WebP, PDF.'));
    } else {
      res
        .status(409)
        .json(body(409, 'ATTACHMENT_DUPLICATE', 'Cette pièce est déjà jointe au dossier.'));
    }
  } else if (err instanceof NotAnAdministratorError) {
    res.status(422).json(
      body(422, 'ASSIGNEE_NOT_ADMIN', 'Ce compte n’est pas un administrateur actif.', {
        fields: { assigneeId: 'Administrateur actif requis.' },
      }),
    );
  } else {
    next(err);
  }
};
