import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { TableBackdrop } from '../../components/table/TableDecor';
import { useMessages } from '../../lib/i18n';
import { useCurrentUser } from '../auth/hooks';
import { ShopFlow } from '../wallet/ShopFlow';
import { useLobbyMetrics } from './lobby-metrics';
import { BackGlyph, EmojiIcon, IconButton, LobbyHud } from './LobbyUi';
import { PrivateGamePanel } from './PrivateGamePanel';
import { ProfilePanel } from './ProfilePanel';
import { SettingsPanel } from './SettingsPanel';

export type LobbyPanelName = 'profile' | 'settings' | 'private' | 'shop';

const LobbyContext = createContext<{ openPanel(panel: LobbyPanelName): void } | null>(null);

/** Ouvre un panneau de la coquille (ex. Privé → Rejoindre → Partie privée). */
export function useLobbyPanels() {
  const value = useContext(LobbyContext);
  if (!value) throw new Error('Composant à utiliser dans <LobbyShell>.');
  return value;
}

/**
 * Coquille des écrans connectés (accueil, tournois) : fond de la table, décor propre à
 * l'écran, HUD, boutons Profil et Réglages en bas à gauche, retour éventuel en bas à droite,
 * et les panneaux superposés. Un seul HUD et une seule logique de panneaux pour tous les
 * écrans.
 *
 *   fond
 *   ├── décor (cartes, cercle…) : jamais interactif
 *   ├── contenu de l'écran
 *   ├── HUD et boutons du bas
 *   └── panneau ouvert (Profil, Réglages, Partie privée)
 */
export function LobbyShell({
  decor,
  onBack,
  children,
}: {
  decor?: ReactNode;
  /** Bouton retour rouge en bas à droite (absent sur l'accueil). */
  onBack?: () => void;
  children: ReactNode;
}) {
  const m = useLobbyMetrics();
  const t = useMessages();
  const { data: user } = useCurrentUser();
  const [panel, setPanel] = useState<LobbyPanelName | null>(null);
  const openPanel = useCallback((next: LobbyPanelName) => setPanel(next), []);
  const closePanel = useCallback(() => setPanel(null), []);

  return (
    <LobbyContext.Provider value={{ openPanel }}>
      <TableBackdrop>
        {decor ? (
          <View
            style={[StyleSheet.absoluteFill, styles.passThrough]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {decor}
          </View>
        ) : null}
        {children}
        <LobbyHud username={user?.username} onAddCoins={() => openPanel('shop')} />
        <View style={[styles.bottomLeft, { left: m.safe.left, bottom: m.safe.bottom, gap: m.gap }]}>
          <IconButton label={t.lobby.profile} onPress={() => openPanel('profile')}>
            <EmojiIcon>🧑</EmojiIcon>
          </IconButton>
          <IconButton label={t.lobby.settings} onPress={() => openPanel('settings')}>
            <EmojiIcon>⚙️</EmojiIcon>
          </IconButton>
        </View>
        {onBack ? (
          <View style={[styles.corner, { right: m.safe.right, bottom: m.safe.bottom }]}>
            <IconButton label={t.lobby.backHome} tone="danger" onPress={onBack}>
              <BackGlyph />
            </IconButton>
          </View>
        ) : null}
        {panel === 'profile' ? <ProfilePanel onClose={closePanel} /> : null}
        {panel === 'settings' ? <SettingsPanel onClose={closePanel} /> : null}
        {panel === 'private' ? <PrivateGamePanel onClose={closePanel} /> : null}
        {panel === 'shop' ? <ShopFlow onClose={closePanel} /> : null}
      </TableBackdrop>
    </LobbyContext.Provider>
  );
}

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'none' },
  bottomLeft: { position: 'absolute', flexDirection: 'row' },
  corner: { position: 'absolute' },
});
