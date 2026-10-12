import { MODERATION_LIMITS } from '../domain/admin/moderation';
import type { RestrictionInput, WarningInput } from '../services/admin/player-moderation.service';
import { ValidationError } from './validation-error';

/**
 * Corps des actions de modération (D-079). Champs connus seulement (un champ inconnu, par
 * exemple un identifiant d'auteur, est REFUSÉ, jamais ignoré) ; textes bruts, espaces de début
 * et de fin retirés, caractères de contrôle refusés (sauf retour à la ligne et tabulation).
 * Les textes ne sont jamais interprétés comme du HTML : l'administration les affiche en texte.
 */
type Body = Record<string, unknown>;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

class BodyReader {
  readonly fields: Record<string, string> = {};
  private readonly body: Body;

  constructor(body: unknown, allowed: readonly string[]) {
    this.body =
      typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Body) : {};
    for (const key of Object.keys(this.body)) {
      if (!allowed.includes(key)) this.fields[key] = 'Champ inconnu.';
    }
  }

  text(key: string, min: number, max: number, required: boolean): string | undefined {
    const value = this.body[key];
    if (value === undefined || value === null || value === '') {
      if (required) this.fields[key] = 'Champ obligatoire.';
      return undefined;
    }
    if (typeof value !== 'string') {
      this.fields[key] = 'Texte attendu.';
      return undefined;
    }
    const text = value.trim();
    if (CONTROL.test(text)) {
      this.fields[key] = 'Caractères non autorisés.';
      return undefined;
    }
    if (text.length < min || text.length > max) {
      if (text.length === 0 && !required) return undefined;
      this.fields[key] = `Entre ${min} et ${max} caractères.`;
      return undefined;
    }
    return text;
  }

  /** Date ISO 8601 avec fuseau ; null ou absente : durée indéterminée. */
  endsAt(): Date | undefined {
    const value = this.body.endsAt;
    if (value === undefined || value === null || value === '') return undefined;
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) ||
      Number.isNaN(new Date(value).getTime())
    ) {
      this.fields.endsAt = 'Date et heure ISO 8601 avec fuseau attendues.';
      return undefined;
    }
    return new Date(value);
  }

  done(): void {
    if (Object.keys(this.fields).length > 0) throw new ValidationError(this.fields);
  }
}

const { reason: R, comment: C, playerMessage: M, note: N } = MODERATION_LIMITS;

export function parseReasonBody(body: unknown, required = true): { reason?: string } {
  const r = new BodyReader(body, ['reason']);
  const reason = r.text('reason', R.min, R.max, required);
  r.done();
  return reason ? { reason } : {};
}

export function parseRestrictionInput(body: unknown): RestrictionInput {
  const r = new BodyReader(body, ['reason', 'comment', 'endsAt']);
  const reason = r.text('reason', R.min, R.max, true);
  const comment = r.text('comment', 1, C.max, false);
  const endsAt = r.endsAt();
  r.done();
  return { reason: reason as string, ...(comment && { comment }), ...(endsAt && { endsAt }) };
}

export function parseWarningInput(body: unknown): WarningInput {
  const r = new BodyReader(body, ['reason', 'playerMessage', 'comment']);
  const reason = r.text('reason', R.min, R.max, true);
  const playerMessage = r.text('playerMessage', 1, M.max, false);
  const comment = r.text('comment', 1, C.max, false);
  r.done();
  return {
    reason: reason as string,
    ...(playerMessage && { playerMessage }),
    ...(comment && { comment }),
  };
}

export function parseNoteInput(body: unknown): { body: string } {
  const r = new BodyReader(body, ['body']);
  const text = r.text('body', 1, N.max, true);
  r.done();
  return { body: text as string };
}
