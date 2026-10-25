import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  fontOf,
  TableBackdrop,
  tablePalette as palette,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { useLanguage, useMessages } from '../../lib/i18n';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { PanelButton } from '../lobby/LobbyUi';
import { getLegalDocument } from './documents';

/** Retour à l'écran précédent (Réglages), ou à l'accueil si l'écran a été ouvert seul. */
export function leaveLegalDocument() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Conditions d'utilisation ou Politique de confidentialité, dans la langue choisie : fond de
 * la table, plaque sombre lisible, texte défilant, marges de sécurité respectées. Le retour
 * Android est géré par la pile de navigation.
 */
export function LegalDocumentScreen({ documentId }: { documentId: string }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const t = useMessages();
  const language = useLanguage();
  const document = useMemo(() => getLegalDocument(documentId, language), [documentId, language]);

  const padding = {
    paddingTop: m.safe.top,
    paddingBottom: m.safe.bottom,
    paddingLeft: m.safe.left,
    paddingRight: m.safe.right,
  };
  const bodyStyle = [styles.body, { fontSize: m.bodySize, lineHeight: Math.round(m.bodySize * 1.5) }];

  return (
    <TableBackdrop>
      <View style={[styles.fill, padding, { gap: m.gap }]}>
        <View style={[styles.header, { gap: m.gap }]}>
          <PanelButton
            title={`‹ ${t.legal.back}`}
            accessibilityLabel={t.legal.backA11y}
            onPress={leaveLegalDocument}
          />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.title, fontOf(fonts.title), { fontSize: m.panelTitleSize * 0.8 }]}
          >
            {document?.title ?? t.legal.notFound}
          </Text>
        </View>
        <View style={[styles.panel, styles.fill]}>
          {document ? (
            <ScrollView
              testID="legal-document-scroll"
              contentContainerStyle={{ padding: m.gap * 1.5, gap: m.gap * 1.2 }}
            >
              <Text style={[styles.updated, fontOf(fonts.button), { fontSize: m.smallSize }]}>
                {t.legal.lastUpdated} : {document.lastUpdated}
              </Text>
              {document.sections.map((section) => (
                <View key={section.heading} style={{ gap: m.gap * 0.5 }}>
                  <Text
                    accessibilityRole="header"
                    style={[styles.heading, fontOf(fonts.button), { fontSize: m.bodySize * 1.2 }]}
                  >
                    {section.heading}
                  </Text>
                  {section.paragraphs.map((paragraph, index) => (
                    <Text
                      key={index}
                      style={[bodyStyle, paragraph.startsWith('•') && { paddingLeft: m.gap }]}
                    >
                      {paragraph}
                    </Text>
                  ))}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.fill, styles.center]}>
              <Text style={bodyStyle}>{t.legal.notFound}</Text>
            </View>
          )}
        </View>
      </View>
    </TableBackdrop>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, color: '#F6EFDF', letterSpacing: 1.2, ...titleShadow },
  panel: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    backgroundColor: palette.panel,
    overflow: 'hidden',
  },
  updated: { color: palette.gold },
  heading: { color: palette.gold },
  body: { color: palette.cream },
});
