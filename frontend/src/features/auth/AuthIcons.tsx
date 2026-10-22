import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { tablePalette as palette } from '../../components/table/TableDecor';

/**
 * Icônes des écrans Connexion et Inscription : purement décoratives (le champ ou le bouton
 * porte déjà son libellé), donc masquées aux lecteurs d'écran.
 */
interface IconProps {
  size?: number;
  color?: string;
}

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no' } as const;

/** Bonhomme : champ « Téléphone ou email », pseudo. */
export function UserIcon({ size = 22, color = palette.gold }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} {...hidden}>
      <Circle cx={12} cy={7.5} r={4.5} />
      <Path d="M3.5 21c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5c0 .6-.4 1-1 1h-15c-.6 0-1-.4-1-1Z" />
    </Svg>
  );
}

/** Cadenas : champs mot de passe. */
export function LockIcon({ size = 22, color = palette.gold }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...hidden}>
      <Path
        d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10"
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <Rect x={4} y={10} width={16} height={12} rx={2.5} fill={color} />
      <Circle cx={12} cy={15.2} r={1.6} fill="#2A1405" />
      <Path d="M12 16.2v2.4" stroke="#2A1405" strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/** Flèche entrant dans une porte : bouton « Se connecter ». */
export function LoginIcon({ size = 20, color = '#2A1405' }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...hidden}
    >
      <Path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <Path d="M3 12h11M10 8l4 4-4 4" />
    </Svg>
  );
}

/** Emplacement d'une icône au début d'un champ `login` (avant la saisie). */
export function FieldIcon({ children }: { children: ReactNode }) {
  return <View style={styles.fieldIcon}>{children}</View>;
}

/** Saisie placée juste après une `FieldIcon` : l'icône tient lieu de marge à gauche. */
export const AFTER_ICON = { paddingLeft: 4 } as const;

const styles = StyleSheet.create({
  fieldIcon: {
    alignSelf: 'stretch',
    flexShrink: 0,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 6,
  },
});
