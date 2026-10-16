import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { useMessages } from '../../lib/i18n';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useLobbyMetrics } from './lobby-metrics';
import { ChoiceGroup, LobbyPanel, PanelButton } from './LobbyUi';

/**
 * Réglages : son et langue (préférences locales persistées, store des préférences), assistance
 * (SUPPORT_URL) et documents légaux (route /legal/[document]). Rien ici ne touche à la partie
 * en cours : le panneau reste identique sur l'accueil et sur la table.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const t = useMessages();
  const soundEnabled = usePreferencesStore((s) => s.soundEnabled);
  const setSoundEnabled = usePreferencesStore((s) => s.setSoundEnabled);
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);

  const label = [
    styles.label,
    fontOf(fonts.button),
    { fontSize: Math.round(m.panelTitleSize * 0.8) },
  ];

  return (
    <LobbyPanel
      title={t.settings.title}
      onClose={onClose}
      closeLabel={t.settings.closeA11y}
      width={Math.max(380, m.width * 0.46)}
      below={
        <View style={[styles.legal, { gap: m.gap * 2, paddingHorizontal: m.gap * 1.5 }]}>
          <LegalLink
            title={t.settings.terms}
            accessibilityLabel={t.settings.termsA11y}
            onPress={() => router.push('/legal/terms')}
          />
          <LegalLink
            title={t.settings.privacy}
            accessibilityLabel={t.settings.privacyA11y}
            onPress={() => router.push('/legal/privacy')}
          />
        </View>
      }
    >
      <View style={[styles.body, { gap: m.gap * 1.2, paddingHorizontal: m.gap * 2 }]}>
        <View style={styles.row}>
          <Text style={label}>{t.settings.sound}</Text>
          <ChoiceGroup>
            <PanelButton
              title={t.settings.on}
              accessibilityLabel={t.settings.soundOnA11y}
              sound="uiConfirm"
              selected={soundEnabled}
              onPress={() => setSoundEnabled(true)}
            />
            <PanelButton
              title={t.settings.off}
              accessibilityLabel={t.settings.soundOffA11y}
              selected={!soundEnabled}
              onPress={() => setSoundEnabled(false)}
            />
          </ChoiceGroup>
        </View>
        <View style={styles.row}>
          <Text style={label}>{t.settings.languages}</Text>
          <ChoiceGroup>
            <PanelButton
              title={t.settings.french}
              accessibilityLabel={t.settings.selectFrenchA11y}
              sound="uiConfirm"
              selected={language === 'fr'}
              onPress={() => setLanguage('fr')}
            />
            <PanelButton
              title={t.settings.english}
              accessibilityLabel={t.settings.selectEnglishA11y}
              sound="uiConfirm"
              selected={language === 'en'}
              onPress={() => setLanguage('en')}
            />
          </ChoiceGroup>
        </View>
        <View style={styles.center}>
          <ChoiceGroup>
            <PanelButton
              title={t.settings.support}
              accessibilityLabel={t.settings.supportA11y}
              // Aide et réclamations dans l'application (D-114) : assistant automatisé et
              // réclamations officielles, utilisables même sans plateforme externe.
              onPress={() => router.push('/support')}
            />
          </ChoiceGroup>
        </View>
      </View>
    </LobbyPanel>
  );
}

function LegalLink({
  title,
  accessibilityLabel,
  onPress,
}: {
  title: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      style={({ pressed }) => [
        styles.link,
        { minHeight: m.controlHeight },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.linkText, fontOf(fonts.button), { fontSize: m.smallSize }]}>
        {title} ↗
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  center: { alignItems: 'center' },
  label: { color: '#FFFFFF' },
  legal: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    backgroundColor: palette.panel,
  },
  link: { justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  linkText: { color: '#FFFFFF' },
});
