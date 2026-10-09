import { createContext, useContext, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  DecorativeCards,
  FeltCircle,
  PillButton,
  TableBackdrop,
  tablePalette as palette,
  titleShadow,
  useTableFonts,
  type TableFonts,
} from '../../components/table/TableDecor';
import { useLandscapeViewport, type LandscapeViewport } from '../../hooks/use-landscape-viewport';

/**
 * Écran de connexion « table de jeu » : fond rouge/brun éclairé, grand cercle de feutre vert
 * cerclé d'or, cartes Le Ter décoratives sur les côtés.
 *
 * Tout est dimensionné à partir de la surface paysage réellement disponible (marges de sécurité
 * déduites), jamais d'une résolution fixe :
 *   racine (fond, plein écran)
 *   ├── cartes décoratives (sous tout le reste, peuvent déborder de l'écran)
 *   └── zone sûre
 *       ├── cercle (diamètre = petite dimension disponible, plafonné par la largeur)
 *       └── colonne de contenu centrée dans le cercle (défile si le clavier la réduit)
 */

export interface LoginTableMetrics {
  /** Diamètre extérieur de l'anneau doré. */
  diameter: number;
  ring: number;
  columnWidth: number;
  titleSize: number;
  /** Hauteur des champs et du bouton (jamais sous 44, taille tactile minimale). */
  controlHeight: number;
  buttonFontSize: number;
  inputFontSize: number;
  smallFontSize: number;
  gap: number;
  cardWidth: number;
  /** Largeur libre entre un bord de l'écran et le cercle, où se placent les cartes. */
  sideSpace: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function computeLoginTableMetrics({
  width,
  height,
  safe,
}: LandscapeViewport): LoginTableMetrics {
  const availableWidth = width - safe.left - safe.right;
  const availableHeight = height - safe.top - safe.bottom;
  // Le cercle occupe toute la hauteur sûre, mais laisse au moins ~17 % de la largeur de chaque
  // côté aux cartes (format 4:3 des tablettes).
  const diameter = Math.round(Math.min(availableHeight, availableWidth * 0.66, 920));
  const ring = Math.round(clamp(diameter * 0.045, 10, 36));
  const sideSpace = (width - diameter) / 2;
  return {
    diameter,
    ring,
    columnWidth: Math.round(clamp((diameter - ring * 2) * 0.78, 200, 440)),
    titleSize: Math.round(clamp(diameter * 0.072, 22, 54)),
    controlHeight: Math.round(clamp(diameter * 0.13, 44, 62)),
    buttonFontSize: Math.round(clamp(diameter * 0.058, 18, 30)),
    inputFontSize: Math.round(clamp(diameter * 0.044, 14, 18)),
    smallFontSize: Math.round(clamp(diameter * 0.034, 12, 15)),
    gap: Math.round(clamp(diameter * 0.022, 6, 14)),
    cardWidth: Math.round(clamp(Math.min(height * 0.21, sideSpace * 0.58), 40, 190)),
    sideSpace,
  };
}

const TableContext = createContext<{ metrics: LoginTableMetrics; fonts: TableFonts } | null>(null);

function useTable() {
  const value = useContext(TableContext);
  if (!value) throw new Error('Composant à utiliser dans <LoginTable>.');
  return value;
}

/** Hauteur et taille de police des champs, pour les aligner sur le bouton. */
export function useLoginTableMetrics(): LoginTableMetrics {
  return useTable().metrics;
}

export function LoginTable({ children }: { children: ReactNode }) {
  const viewport = useLandscapeViewport();
  const metrics = computeLoginTableMetrics(viewport);
  const fonts = useTableFonts();
  const { safe } = viewport;
  const safeFrame = { top: safe.top, bottom: safe.bottom, left: safe.left, right: safe.right };

  return (
    <TableContext.Provider value={{ metrics, fonts }}>
      <TableBackdrop>
        <DecorativeCards
          cardWidth={metrics.cardWidth}
          sideSpace={metrics.sideSpace}
          fontFamily={fonts.title}
        />
        <View style={[styles.layer, safeFrame, styles.centered, styles.passThrough]}>
          <FeltCircle diameter={metrics.diameter} ring={metrics.ring} />
        </View>
        <ScrollView
          style={[styles.layer, safeFrame]}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={{ width: metrics.columnWidth }}>{children}</View>
        </ScrollView>
      </TableBackdrop>
    </TableContext.Provider>
  );
}

export function TableTitle({ children }: { children: string }) {
  const { metrics, fonts } = useTable();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      adjustsFontSizeToFit
      style={[
        styles.title,
        {
          fontSize: metrics.titleSize,
          fontFamily: fonts.title,
          fontWeight: fonts.title ? undefined : '800',
          marginBottom: Math.round(metrics.gap * 1.6),
        },
      ]}
    >
      {children}
    </Text>
  );
}

/** Bouton pilule turquoise de la maquette. */
export function TableButton({
  title,
  onPress,
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { metrics, fonts } = useTable();
  return (
    <PillButton
      title={title}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      height={metrics.controlHeight}
      fontSize={metrics.buttonFontSize}
      fontFamily={fonts.button}
    />
  );
}

/** Lien texte doré ; la zone tactile est étendue à ~44 px de haut. */
export function TableLink({
  title,
  onPress,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { metrics } = useTable();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="link"
      hitSlop={{ top: 8, bottom: 8, left: 10, right: 10 }}
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed, style]}
    >
      <Text style={[styles.linkText, { fontSize: metrics.smallFontSize }]}>{title}</Text>
    </Pressable>
  );
}

/** Ligne « question + lien », sur une plaque sombre pour rester lisible près de l'anneau. */
export function TableFooter({
  prompt,
  linkTitle,
  onPress,
  disabled,
}: {
  prompt: string;
  linkTitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { metrics } = useTable();
  return (
    <View style={[styles.footer, { marginTop: metrics.gap }]}>
      <Text style={[styles.footerText, { fontSize: metrics.smallFontSize }]}>{prompt}</Text>
      <TableLink title={linkTitle} onPress={onPress} disabled={disabled} />
    </View>
  );
}

/** Message d'erreur unique (validation ou serveur), annoncé par les lecteurs d'écran. */
export function TableMessage({ message }: { message?: string }) {
  const { metrics } = useTable();
  if (!message) return null;
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.message, { fontSize: metrics.smallFontSize, marginBottom: metrics.gap }]}
    >
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  passThrough: { pointerEvents: 'none' },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  title: {
    color: palette.cream,
    textAlign: 'center',
    letterSpacing: 1,
    ...titleShadow,
  },
  link: { minHeight: 28, justifyContent: 'center' },
  linkPressed: { opacity: 0.65 },
  linkText: { color: palette.gold, fontWeight: '700' },
  footer: {
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 6,
    paddingHorizontal: 14,
    paddingVertical: 2,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  footerText: { color: palette.cream, opacity: 0.85 },
  message: { color: palette.error, textAlign: 'center', fontWeight: '600' },
});
