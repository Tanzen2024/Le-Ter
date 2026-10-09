import type { LegalInfo } from '../../constants/app-config';
import type { Language } from '../../stores/preferences-store';

export type LegalDocumentId = 'terms' | 'privacy';

export interface LegalSection {
  heading: string;
  /** Paragraphes ; une ligne commençant par « • » s'affiche comme une puce. */
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  lastUpdated: string;
  sections: LegalSection[];
}

/** Informations légales prêtes à afficher : inconnues → repère entre crochets. */
export interface ResolvedLegalInfo {
  publisherName: string;
  address: string;
  email: string;
  lastUpdated: string;
  jurisdiction: string;
  minimumAge: string;
}

const PLACEHOLDERS: Record<Language, ResolvedLegalInfo> = {
  fr: {
    publisherName: "[Nom légal de l'éditeur]",
    address: '[Adresse]',
    email: '[Email]',
    lastUpdated: '[Date de dernière mise à jour]',
    jurisdiction: '[Pays / juridiction]',
    minimumAge: '[Âge minimum]',
  },
  en: {
    publisherName: '[Publisher legal name]',
    address: '[Address]',
    email: '[Email]',
    lastUpdated: '[Last updated date]',
    jurisdiction: '[Country / jurisdiction]',
    minimumAge: '[Minimum age]',
  },
};

export function resolveLegalInfo(info: LegalInfo, language: Language): ResolvedLegalInfo {
  const placeholder = PLACEHOLDERS[language];
  const text = (value: string | null) => (value && value.trim() ? value.trim() : null);
  return {
    publisherName: text(info.publisherName) ?? placeholder.publisherName,
    address: text(info.address) ?? placeholder.address,
    email: text(info.email) ?? placeholder.email,
    lastUpdated: text(info.lastUpdated) ?? placeholder.lastUpdated,
    jurisdiction: text(info.jurisdiction) ?? placeholder.jurisdiction,
    minimumAge: info.minimumAge === null ? placeholder.minimumAge : String(info.minimumAge),
  };
}
