import { useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { gameTheme, salon } from '../../constants/theme';

export type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
export type PopoverSide = 'below' | 'above' | 'right' | 'left';

/** Écart entre le champ et la fenêtre, et marge gardée au bord de l'écran. */
const GAP = 6;
const MARGIN = 8;

const clamp = (value: number, min: number, max: number) =>
  max < min ? min : Math.min(Math.max(value, min), max);

/**
 * Position de la fenêtre accrochée à son champ : dessous, sinon dessus, sinon à droite, sinon
 * à gauche (paysage : écran bas, la place est souvent sur le côté). Si aucun côté ne suffit,
 * elle se pose du côté le plus large et reste entière dans l'écran.
 */
export function placePopover(
  anchor: Rect,
  size: Size,
  screen: Size,
): { left: number; top: number; side: PopoverSide } {
  const alignX = clamp(anchor.x, MARGIN, screen.width - MARGIN - size.width);
  const alignY = clamp(anchor.y, MARGIN, screen.height - MARGIN - size.height);
  const below = anchor.y + anchor.height + GAP;
  const above = anchor.y - GAP - size.height;
  const right = anchor.x + anchor.width + GAP;
  const left = anchor.x - GAP - size.width;

  if (below + size.height <= screen.height - MARGIN) return { left: alignX, top: below, side: 'below' };
  if (above >= MARGIN) return { left: alignX, top: above, side: 'above' };
  if (right + size.width <= screen.width - MARGIN) return { left: right, top: alignY, side: 'right' };
  if (left >= MARGIN) return { left, top: alignY, side: 'left' };
  const roomBelow = screen.height - below;
  const roomAbove = anchor.y - GAP;
  return {
    left: alignX,
    top: clamp(roomBelow >= roomAbove ? below : above, MARGIN, screen.height - MARGIN - size.height),
    side: roomBelow >= roomAbove ? 'below' : 'above',
  };
}

/**
 * Fenêtre légère accrochée à son champ (calendrier, horloge) : l'écran courant reste visible
 * autour d'elle (D-164, exception à D-126). Un appui hors d'elle la referme sans rien changer,
 * comme un sélecteur classique ; le bouton retour d'Android aussi.
 *
 * `anchor` : position du champ dans la fenêtre (`measureInWindow`). Inconnue, la fenêtre se
 * centre. Elle reste invisible jusqu'à connaître sa propre taille (jamais de saut visible).
 */
export function AnchoredPopover({
  visible,
  anchor,
  label,
  closeLabel,
  onClose,
  children,
  testID,
}: {
  visible: boolean;
  anchor: Rect | undefined;
  /** Nom de la fenêtre pour les lecteurs d'écran. */
  label: string;
  /** Libellé de la zone hors de la fenêtre (elle la referme). */
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}) {
  const screen = useWindowDimensions();
  const [size, setSize] = useState<Size>();
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.width !== width || size.height !== height) setSize({ width, height });
  };
  const position = size
    ? anchor
      ? placePopover(anchor, size, screen)
      : {
          left: Math.max(MARGIN, (screen.width - size.width) / 2),
          top: Math.max(MARGIN, (screen.height - size.height) / 2),
        }
    : { left: 0, top: 0 };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['landscape', 'portrait']}
      onRequestClose={onClose}
    >
      <Pressable
        testID={testID ? `${testID}-outside` : undefined}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      <View
        testID={testID}
        accessibilityViewIsModal
        accessibilityLabel={label}
        onLayout={onLayout}
        style={[
          styles.card,
          {
            left: position.left,
            top: position.top,
            maxWidth: screen.width - MARGIN * 2,
            maxHeight: screen.height - MARGIN * 2,
            opacity: size ? 1 : 0,
          },
        ]}
      >
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Carte douce : grands arrondis, filet de laiton léger, ombre diffuse.
  card: {
    position: 'absolute',
    borderRadius: salon.radius.panel,
    borderWidth: 1,
    borderColor: gameTheme.brass.hairline,
    backgroundColor: salon.surface.fill,
    experimental_backgroundImage: salon.surface.gradient,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35)',
    padding: 10,
    gap: 8,
    overflow: 'hidden',
  },
});
