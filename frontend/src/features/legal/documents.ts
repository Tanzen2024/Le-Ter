import { LEGAL_INFO, type LegalInfo } from '../../constants/app-config';
import type { Language } from '../../stores/preferences-store';
import { privacyEn } from './content/privacy.en';
import { privacyFr } from './content/privacy.fr';
import { termsEn } from './content/terms.en';
import { termsFr } from './content/terms.fr';
import { resolveLegalInfo, type LegalDocument, type LegalDocumentId, type ResolvedLegalInfo } from './types';

const BUILDERS: Record<LegalDocumentId, Record<Language, (info: ResolvedLegalInfo) => LegalDocument>> = {
  terms: { fr: termsFr, en: termsEn },
  privacy: { fr: privacyFr, en: privacyEn },
};

export function isLegalDocumentId(value: unknown): value is LegalDocumentId {
  return value === 'terms' || value === 'privacy';
}

/** Document légal dans la langue demandée, `null` si l'identifiant est inconnu. */
export function getLegalDocument(
  id: string,
  language: Language,
  info: LegalInfo = LEGAL_INFO,
): LegalDocument | null {
  if (!isLegalDocumentId(id)) return null;
  const build = BUILDERS[id][language] ?? BUILDERS[id].fr;
  return build(resolveLegalInfo(info, language));
}
