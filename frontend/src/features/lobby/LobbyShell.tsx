import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TableBackdrop } from '../../components/table/TableDecor';
import { useMessages } from '../../lib/i18n';
import { useCurrentUser } from '../auth/hooks';
import {
  onLobbyPanelRequest,
  rememberLobbyPanel,
  takeLobbyPanelRequest,
} from '../navigation/last-route';
import { ShopFlow } from '../wallet/ShopFlow';
import { useLobbyMetrics } from './lobby-metrics';
import { BackGlyph, EmojiIcon, HudInsetsContext, IconButton, LobbyHud } from './LobbyUi';
import { PrivateGamePanel } from './PrivateGamePanel';
import { ProfilePanel } from './ProfilePanel';
import { SettingsPanel } from './SettingsPanel';

export type LobbyPanelName = 'profile' | 'settings' | 'private' | 'garam' | 'shop';

const LobbyContext = createContext<{
  openPanel(panel: LobbyPanelName): void;
  /** Panneau ouvert au premier plan (null : aucun). */
  panel: LobbyPanelName | null;
} | null>(null);

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
 *   ├── couche ÉCRAN
 *   │   ├── décor (cartes, cercle…) : jamais interactif
 *   │   ├── contenu de l'écran
 *   │   └── HUD et boutons du bas
 *   └── couche PANNEAUX : panneau ouvert (Profil, Réglages, Partie privée)
 *
 * Deux couches sœurs : un `zIndex` posé dans l'écran (titre au-dessus des cartes…) reste
 * confiné à sa couche et ne passe jamais devant un panneau ouvert. Panneau ouvert, il est SEUL
 * visible et interactif (D-126) : la couche écran, couverte par son fond opaque, ne reçoit
 * plus aucun appui et disparaît pour les lecteurs d'écran jusqu'à sa fermeture.
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
  // Emprise du HUD, mesurée : les panneaux ouverts restent entre ses deux blocs (D-133).
  const [hudInsets, setHudInsets] = useState({ left: 0, right: 0 });
  const onHudInsets = useCallback(
    (next: { left?: number; right?: number }) =>
      setHudInsets((current) => {
        const merged = { ...current, ...next };
        return merged.left === current.left && merged.right === current.right ? current : merged;
      }),
    [],
  );

  // Écran affiché : son panneau ouvert est mémorisé avec l'écran (rouvert si Android détruit
  // le processus) et un panneau à restaurer lui est remis ; quitté : plus aucun panneau.
  const focused = useRef(false);
  const shownPanel = useRef(panel);
  useEffect(() => {
    shownPanel.current = panel;
    if (focused.current) rememberLobbyPanel(panel);
  }, [panel]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      rememberLobbyPanel(shownPanel.current);
      const take = () => {
        const restored = takeLobbyPanelRequest();
        if (restored) setPanel(restored);
      };
      take();
      const off = onLobbyPanelRequest(take);
      return () => {
        focused.current = false;
        off();
        rememberLobbyPanel(null);
      };
    }, []),
  );

  return (
    <LobbyContext.Provider value={{ openPanel, panel }}>
      <TableBackdrop>
        <View
          style={[StyleSheet.absoluteFill, panel && styles.passThrough]}
          accessibilityElementsHidden={panel !== null}
          importantForAccessibility={panel ? 'no-hide-descendants' : 'auto'}
        >
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
          <View
            style={[styles.bottomLeft, { left: m.safe.left, bottom: m.safe.bottom, gap: m.gap }]}
          >
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
        </View>
        <HudInsetsContext.Provider value={hudInsets}>
          {panel === 'profile' ? <ProfilePanel onClose={closePanel} /> : null}
          {panel === 'settings' ? <SettingsPanel onClose={closePanel} /> : null}
          {panel === 'private' ? <PrivateGamePanel onClose={closePanel} /> : null}
          {panel === 'garam' ? <PrivateGamePanel gameType="GARAM" onClose={closePanel} /> : null}
          {panel === 'shop' ? <ShopFlow onClose={closePanel} /> : null}
        </HudInsetsContext.Provider>
        {/* HUD au premier plan, même panneau ou avertissement ouvert (D-133) : pseudo, numéro
            d'ordre et solde restent visibles. Panneau ouvert, il n'est plus touchable : seul
            le panneau est interactif (D-126). */}
        <View
          testID="hud-layer"
          style={[
            StyleSheet.absoluteFill,
            styles.hudLayer,
            panel ? styles.passThrough : styles.boxNone,
          ]}
        >
          <LobbyHud
            username={user?.username}
            playerNumber={user?.playerNumber}
            onAddCoins={() => openPanel('shop')}
            inert={panel !== null}
            onInsets={onHudInsets}
          />
        </View>
      </TableBackdrop>
    </LobbyContext.Provider>
  );
}

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'none' },
  boxNone: { pointerEvents: 'box-none' },
  // Au-dessus des fenêtres exclusives (zIndex 100) : le HUD n'est jamais recouvert.
  hudLayer: { zIndex: 200, elevation: 200 },
  bottomLeft: { position: 'absolute', flexDirection: 'row' },
  corner: { position: 'absolute' },
});
