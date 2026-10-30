/**
 * Textes juridiques (« npm run legal:sync ») : copie dans src/legal/documents.json les
 * Conditions d'utilisation et la Politique de confidentialité de l'application mobile, en
 * français et en anglais, sans les reformuler. Puis `npm run generate` refait les pages.
 *
 * Source : frontend/src/features/legal/content/{terms,privacy}.{fr,en}.ts, appelés comme le fait
 * l'application (getLegalDocument : `resolveLegalInfo(LEGAL_INFO, langue)`). Tant que LEGAL_INFO
 * est à null, les repères entre crochets (« [Nom légal de l'éditeur] »…) apparaissent comme dans
 * l'application. Lit frontend/ sans jamais le modifier ; le site n'en dépend pas pour se construire.
 * tests/legal.test.mjs vérifie que l'instantané est toujours identique à la source.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FRONTEND_LEGAL = resolve(ROOT, '../frontend/src/features/legal');
const APP_CONFIG = resolve(ROOT, '../frontend/src/constants/app-config.ts');
export const SNAPSHOT = join(ROOT, 'src/legal/documents.json');

const SOURCES = {
  terms: { fr: ['content/terms.fr.ts', 'termsFr'], en: ['content/terms.en.ts', 'termsEn'] },
  privacy: { fr: ['content/privacy.fr.ts', 'privacyFr'], en: ['content/privacy.en.ts', 'privacyEn'] },
};

const importTs = (path) => import(pathToFileURL(path).href);

/** { sources, fr: { terms, privacy }, en: { terms, privacy } } tels que l'application les affiche. */
export async function readAppDocuments() {
  const { resolveLegalInfo } = await importTs(join(FRONTEND_LEGAL, 'types.ts'));
  const { LEGAL_INFO } = await importTs(APP_CONFIG);
  const snapshot = { sources: { fr: {}, en: {} }, fr: {}, en: {} };
  for (const [id, languages] of Object.entries(SOURCES)) {
    for (const [lang, [file, builder]] of Object.entries(languages)) {
      const module = await importTs(join(FRONTEND_LEGAL, file));
      snapshot[lang][id] = module[builder](resolveLegalInfo(LEGAL_INFO, lang));
      snapshot.sources[lang][id] = `frontend/src/features/legal/${file}`;
    }
  }
  return snapshot;
}

export const serializeSnapshot = (snapshot) => `${JSON.stringify(snapshot, null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(FRONTEND_LEGAL)) {
    console.error(`✗ Source introuvable : ${FRONTEND_LEGAL}`);
    process.exit(1);
  }
  writeFileSync(SNAPSHOT, serializeSnapshot(await readAppDocuments()));
  console.log('✓ src/legal/documents.json mis à jour. Lancer ensuite : npm run generate');
}
