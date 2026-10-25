import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { useMessages } from '../../lib/i18n';
import { isMusicAvailable } from '../../services/audio-service';
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
  const effectsVolume = usePreferencesStore((s) => s.effectsVolume);
  const setEffectsVolume = usePreferencesStore((s) => s.setEffectsVolume);
  const musicEnabled = usePreferencesStore((s) => s.musicEnabled);
  const setMusicEnabled = usePreferencesStore((s) => s.setMusicEnabled);
  const musicVolume = usePreferencesStore((s) => s.musicVolume);
  const setMusicVolume = usePreferencesStore((s) => s.setMusicVolume);
  // Réglage Musique proposé seulement si des pistes existent (expo-music-player).
  const music = isMusicAvailable();
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);

  // Paysage : la hauteur est rare, la largeur abondante. Les réglages tiennent sur deux
  // colonnes et l'Assistance reste visible dans la barre du bas, sans défilement.
  const label = [styles.label, fontOf(fonts.button), { fontSize: Math.round(m.bodySize * 1.05) }];
  const column = [styles.column, { gap: m.gap * 0.7 }];

  return (
    <LobbyPanel
      title={t.settings.title}
      onClose={onClose}
      closeLabel={t.settings.closeA11y}
      // Assez large pour les deux colonnes côte à côte (≈ 600 dp), plafonné par l'écran.
      width={Math.max(600, m.width * 0.8)}
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
      <View style={[styles.body, { gap: m.gap * 0.9, paddingHorizontal: m.gap }]}>
        <View style={[styles.grid, { gap: m.gap * 1.4 }]}>
          {/* Colonne 1 : effets sonores. Le son de confirmation, joué après le choix, fait
              entendre le nouveau niveau ; rien ne joue tant que le son est coupé. */}
          <View style={column}>
            <View style={[styles.item, { gap: m.gap * 0.3 }]}>
              <Text style={label}>{t.settings.sound}</Text>
              <ChoiceGroup style={styles.itemChoices}>
                <PanelButton
                  compact
                  title={t.settings.on}
                  accessibilityLabel={t.settings.soundOnA11y}
                  sound="uiConfirm"
                  selected={soundEnabled}
                  onPress={() => setSoundEnabled(true)}
                />
                <PanelButton
                  compact
                  title={t.settings.off}
                  accessibilityLabel={t.settings.soundOffA11y}
                  selected={!soundEnabled}
                  onPress={() => setSoundEnabled(false)}
                />
              </ChoiceGroup>
            </View>
            <View style={[styles.item, { gap: m.gap * 0.3 }]}>
              <Text style={label}>{t.settings.volume}</Text>
              <ChoiceGroup style={styles.itemChoices}>
                {(
                  [
                    ['low', t.settings.volumeLow, t.settings.volumeLowA11y],
                    ['medium', t.settings.volumeMedium, t.settings.volumeMediumA11y],
                    ['high', t.settings.volumeHigh, t.settings.volumeHighA11y],
                  ] as const
                ).map(([level, title, a11y]) => (
                  <PanelButton
                    compact
                    key={level}
                    title={title}
                    accessibilityLabel={a11y}
                    sound="uiConfirm"
                    selected={effectsVolume === level}
                    onPress={() => setEffectsVolume(level)}
                  />
                ))}
              </ChoiceGroup>
            </View>
          </View>
          {/* Colonne 2 : musique de partie, réglages distincts des effets (si des pistes existent). */}
          {music ? (
            <View style={[column, styles.secondColumn, { paddingLeft: m.gap * 1.4 }]}>
              <View style={[styles.item, { gap: m.gap * 0.3 }]}>
                <Text style={label}>{t.settings.music}</Text>
                <ChoiceGroup style={styles.itemChoices}>
                  <PanelButton
                    compact
                    title={t.settings.on}
                    accessibilityLabel={t.settings.musicOnA11y}
                    sound="uiConfirm"
                    selected={musicEnabled}
                    onPress={() => setMusicEnabled(true)}
                  />
                  <PanelButton
                    compact
                    title={t.settings.off}
                    accessibilityLabel={t.settings.musicOffA11y}
                    selected={!musicEnabled}
                    onPress={() => setMusicEnabled(false)}
                  />
                </ChoiceGroup>
              </View>
              <View style={[styles.item, { gap: m.gap * 0.3 }]}>
                <Text style={label}>{t.settings.musicVolume}</Text>
                <ChoiceGroup style={styles.itemChoices}>
                  {(
                    [
                      ['low', t.settings.volumeLow, t.settings.musicVolumeLowA11y],
                      ['medium', t.settings.volumeMedium, t.settings.musicVolumeMediumA11y],
                      ['high', t.settings.volumeHigh, t.settings.musicVolumeHighA11y],
                    ] as const
                  ).map(([level, title, a11y]) => (
                    <PanelButton
                      compact
                      key={level}
                      title={title}
                      accessibilityLabel={a11y}
                      selected={musicVolume === level}
                      onPress={() => setMusicVolume(level)}
                    />
                  ))}
                </ChoiceGroup>
              </View>
            </View>
          ) : null}
        </View>
        {/* Barre du bas, toujours visible : langue à gauche, Assistance à droite. */}
        <View style={[styles.footer, { gap: m.gap, paddingTop: m.gap * 0.8 }]}>
          <View style={[styles.row, styles.footerLanguage]}>
            <Text style={label}>{t.settings.languages}</Text>
            <ChoiceGroup style={styles.choices}>
              <PanelButton
                compact
                title={t.settings.french}
                accessibilityLabel={t.settings.selectFrenchA11y}
                sound="uiConfirm"
                selected={language === 'fr'}
                onPress={() => setLanguage('fr')}
              />
              <PanelButton
                compact
                title={t.settings.english}
                accessibilityLabel={t.settings.selectEnglishA11y}
                sound="uiConfirm"
                selected={language === 'en'}
                onPress={() => setLanguage('en')}
              />
            </ChoiceGroup>
          </View>
          <ChoiceGroup style={styles.choices}>
            <PanelButton
              compact
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
  // Deux colonnes côte à côte à leur largeur naturelle ; sans la place, elles passent l'une sous
  // l'autre (jamais rétrécies sous leur contenu : aucun bouton chevauché ni tronqué).
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  column: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' },
  /** Libellé AU-DESSUS de ses options : colonne étroite, deux colonnes tiennent côte à côte. */
  item: { alignItems: 'flex-start' },
  itemChoices: { alignSelf: 'flex-start' },
  secondColumn: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: palette.panelBorder,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.panelBorder,
  },
  footerLanguage: { flexGrow: 1 },
  // Écran étroit : le groupe d'options passe sous le libellé plutôt que d'être coupé au bord
  // du panneau (trois choix de volume : « Doux / Moyen / Fort »).
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: { color: '#FFFFFF', flexShrink: 1 },
  /** Groupe jamais rétréci (aucun bouton tronqué), aligné à droite même après un retour à la ligne. */
  choices: { marginLeft: 'auto', flexShrink: 0 },
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
