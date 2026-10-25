import { memo, useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { BRAND_INITIAL, fontOf, useTableFonts } from '../../../components/table/TableDecor';
import { gameTheme } from '../../../constants/theme';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';
import { useReducedMotion } from './turn-signal';

/** Allumage de la lampe à l'arrivée sur la table (décor seulement, jamais les cartes). */
export const LAMP_ON_MS = 700;

/**
 * La lampe s'allume une fois, au montage : la flaque de lumière passe de 0 à 1. N'agit que sur
 * le décor ; avec « réduire les animations », allumée d'emblée.
 */
function useLampOn(): Animated.Value {
  const reduced = useReducedMotion();
  const [glow] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) {
      glow.setValue(1);
      return;
    }
    const animation = Animated.timing(glow, {
      toValue: 1,
      duration: LAMP_ON_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [glow, reduced]);
  return glow;
}

/**
 * Salle et table de jeu, « salon Art déco » d'Ébène & Laiton (`gameTheme`) : une salle
 * plongée dans la pénombre, encadrée d'un double filet de laiton, une lampe suspendue qui
 * n'éclaire que la table ; la table elle-même a un rail de cuir rembourré, surpiqué et clouté,
 * une fine bande de noyer incrustée de laiton et un feutre imprimé (filets, losanges, soleil
 * autour de l'anneau gravé).
 *
 * Décor statique, sans animation, qui ne capte aucun geste. La géométrie reste celle de la
 * disposition (`diameter`, `ring`, `ringBorder`) : positions des cartes, zone de dépôt et
 * calculs de collision ne changent pas. Présentation seulement : aucun état de jeu.
 */

const t = gameTheme;

/** Salle de jeu : pénombre vert nuit, faisceau de la lampe, cadre et éventails de laiton. */
export function FeltBackdrop({ children }: { children: ReactNode }) {
  const { width, height } = useLobbyMetrics();
  return (
    <View style={styles.room}>
      <View
        style={[StyleSheet.absoluteFill, styles.passThrough]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <RoomOrnaments width={width} height={height} />
        <View style={[StyleSheet.absoluteFill, styles.vignette]} />
      </View>
      {children}
    </View>
  );
}

/** Éventail Art déco d'un coin (repère : le coin en 0,0, l'éventail vers +x +y). */
function CornerFan({ size, transform }: { size: number; transform?: string }) {
  const arcs = [0.38, 0.62, 0.86];
  const rays = [10, 22, 34, 45, 56, 68, 80];
  const inner = size * 0.16;
  return (
    <G transform={transform}>
      {arcs.map((ratio) => {
        const r = size * ratio;
        return (
          <Path
            key={ratio}
            d={`M0 ${r} A ${r} ${r} 0 0 0 ${r} 0`}
            fill="none"
            stroke={t.room.ornament}
            strokeWidth={ratio === 0.86 ? 1.4 : 0.9}
          />
        );
      })}
      {rays.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const r = size * 0.86;
        return (
          <Path
            key={deg}
            d={`M${inner * Math.cos(a)} ${inner * Math.sin(a)} L${r * Math.cos(a)} ${r * Math.sin(a)}`}
            stroke={t.room.ornament}
            strokeWidth={0.7}
          />
        );
      })}
    </G>
  );
}

/** Rectangle aux coins coupés (cadre Art déco). */
function chamferedFrame(x: number, y: number, w: number, h: number, cut: number): string {
  return [
    `M${x + cut} ${y}`,
    `L${x + w - cut} ${y}`,
    `L${x + w} ${y + cut}`,
    `L${x + w} ${y + h - cut}`,
    `L${x + w - cut} ${y + h}`,
    `L${x + cut} ${y + h}`,
    `L${x} ${y + h - cut}`,
    `L${x} ${y + cut}`,
    'Z',
  ].join(' ');
}

/** Losange centré en (x, y), de demi-diagonale `r`. */
function diamond(x: number, y: number, r: number): string {
  return `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`;
}

/**
 * Décor de la salle en un seul dessin : faisceau de la lampe (du haut de l'écran vers la
 * table), double cadre de laiton à coins coupés, losanges aux milieux et éventails aux coins.
 */
const RoomOrnaments = memo(function RoomOrnaments({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const short = Math.min(width, height);
  const inset = Math.round(short * 0.03);
  const cut = Math.round(short * 0.05);
  const gap = Math.max(4, Math.round(short * 0.012));
  const fan = Math.round(short * 0.26);
  const cx = width / 2;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="roomBeam" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE2A8" stopOpacity="0.07" />
          <Stop offset="0.55" stopColor="#FFE2A8" stopOpacity="0.035" />
          <Stop offset="1" stopColor="#FFE2A8" stopOpacity="0" />
        </LinearGradient>
        <Pattern id="roomLattice" width="34" height="34" patternUnits="userSpaceOnUse">
          <Path d="M17 0 L34 17 L17 34 L0 17 Z" fill="none" stroke={t.brass.main} strokeWidth="0.5" />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill="url(#roomLattice)" opacity={0.045} />
      {/* Faisceau de la lampe suspendue, large en bas, qui se perd sous la table. */}
      <Path
        d={`M${cx - width * 0.07} 0 L${cx + width * 0.07} 0 L${cx + width * 0.36} ${height} L${cx - width * 0.36} ${height} Z`}
        fill="url(#roomBeam)"
      />
      <Path
        d={chamferedFrame(inset, inset, width - inset * 2, height - inset * 2, cut)}
        fill="none"
        stroke={t.brass.main}
        strokeOpacity={0.24}
        strokeWidth={1.2}
      />
      <Path
        d={chamferedFrame(
          inset + gap,
          inset + gap,
          width - (inset + gap) * 2,
          height - (inset + gap) * 2,
          Math.max(0, cut - gap * 0.6),
        )}
        fill="none"
        stroke={t.brass.main}
        strokeOpacity={0.12}
        strokeWidth={0.8}
      />
      <Path d={diamond(cx, inset, gap * 0.9)} fill={t.brass.main} fillOpacity={0.35} />
      <Path d={diamond(cx, height - inset, gap * 0.9)} fill={t.brass.main} fillOpacity={0.35} />
      <Path d={diamond(inset, height / 2, gap * 0.9)} fill={t.brass.main} fillOpacity={0.3} />
      <Path d={diamond(width - inset, height / 2, gap * 0.9)} fill={t.brass.main} fillOpacity={0.3} />
      <CornerFan size={fan} transform={`translate(${inset + gap} ${inset + gap})`} />
      <CornerFan size={fan} transform={`translate(${width - inset - gap} ${inset + gap}) scale(-1 1)`} />
      <CornerFan size={fan} transform={`translate(${inset + gap} ${height - inset - gap}) scale(1 -1)`} />
      <CornerFan
        size={fan}
        transform={`translate(${width - inset - gap} ${height - inset - gap}) scale(-1 -1)`}
      />
    </Svg>
  );
});

/** Trame du feutre : fin croisillon sombre, perceptible de près seulement. */
function FeltWeave({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="feltWeave" width="5" height="5" patternUnits="userSpaceOnUse">
          <Path d="M0 5 L5 0" stroke={t.felt.weave} strokeWidth="0.6" />
          <Path d="M0 0 L5 5" stroke="#3FA67A" strokeWidth="0.4" opacity="0.5" />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} fill="url(#feltWeave)" opacity={0.22} />
    </Svg>
  );
}

/** Rail de cuir : surpiqûre de laiton près du bord et huit clous de laiton. */
function RailDetails({ diameter, rail }: { diameter: number; rail: number }) {
  const c = diameter / 2;
  const stitchR = c - rail * 0.24;
  const studR = c - rail * 0.58;
  const stud = Math.max(1.4, rail * 0.14);
  const dash = Math.max(2, diameter * 0.011);
  return (
    <Svg width={diameter} height={diameter} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="railStud" cx="0.35" cy="0.3" r="0.75">
          <Stop offset="0" stopColor="#FFF0BE" />
          <Stop offset="0.45" stopColor={t.brass.main} />
          <Stop offset="1" stopColor={t.brass.deep} />
        </RadialGradient>
      </Defs>
      <Circle
        cx={c}
        cy={c}
        r={stitchR}
        fill="none"
        stroke={t.leather.stitch}
        strokeWidth={Math.max(0.8, rail * 0.07)}
        strokeDasharray={`${dash} ${dash * 0.8}`}
      />
      {Array.from({ length: 8 }, (_, i) => {
        const a = ((i * 45 + 22.5) * Math.PI) / 180;
        return (
          <Circle
            key={i}
            cx={c + studR * Math.cos(a)}
            cy={c + studR * Math.sin(a)}
            r={stud}
            fill="url(#railStud)"
            stroke="rgba(0, 0, 0, 0.55)"
            strokeWidth={0.6}
          />
        );
      })}
    </Svg>
  );
}

/**
 * Impressions du feutre : double filet circulaire près du bord, losanges aux quatre points
 * cardinaux, et soleil de rayons alternés autour de l'anneau gravé (Art déco).
 */
function FeltPrint({ felt, ring }: { felt: number; ring: number }) {
  const c = felt / 2;
  const outer = felt * 0.455;
  const inner = felt * 0.438;
  const rayIn = ring / 2 + felt * 0.018;
  const rayLong = Math.min(inner - felt * 0.03, rayIn + felt * 0.06);
  const rayShort = rayIn + (rayLong - rayIn) * 0.55;
  const mark = felt * 0.016;
  return (
    <Svg width={felt} height={felt} style={StyleSheet.absoluteFill}>
      <Circle
        cx={c}
        cy={c}
        r={outer}
        fill="none"
        stroke={t.print.line}
        strokeWidth={Math.max(1, felt * 0.004)}
      />
      <Circle cx={c} cy={c} r={inner} fill="none" stroke={t.print.faint} strokeWidth={0.8} />
      {[0, 90, 180, 270].map((deg) => {
        const a = (deg * Math.PI) / 180;
        const r = (outer + inner) / 2;
        return (
          <Path
            key={deg}
            d={diamond(c + r * Math.cos(a), c + r * Math.sin(a), mark)}
            fill={t.print.line}
          />
        );
      })}
      {[45, 135, 225, 315].map((deg) => {
        const a = (deg * Math.PI) / 180;
        const r = (outer + inner) / 2;
        return (
          <Circle
            key={deg}
            cx={c + r * Math.cos(a)}
            cy={c + r * Math.sin(a)}
            r={mark * 0.4}
            fill={t.print.line}
          />
        );
      })}
      {rayLong > rayIn
        ? Array.from({ length: 48 }, (_, i) => {
            const a = (i * 7.5 * Math.PI) / 180;
            const r = i % 2 === 0 ? rayLong : rayShort;
            return (
              <Path
                key={i}
                d={`M${c + rayIn * Math.cos(a)} ${c + rayIn * Math.sin(a)} L${c + r * Math.cos(a)} ${c + r * Math.sin(a)}`}
                stroke={i % 2 === 0 ? t.print.line : t.print.faint}
                strokeWidth={i % 2 === 0 ? 1 : 0.7}
              />
            );
          })
        : null}
    </Svg>
  );
}

/**
 * La table, vue de dessus. De l'extérieur vers le centre :
 * 1. flaque de lumière chaude de la lampe, débordant sur le sol autour de la table ;
 * 2. rail de cuir sang-de-bœuf rembourré (reflet en haut, ombre en bas), surpiqûre et clous ;
 * 3. bande de noyer verni incrustée d'un filet de laiton ;
 * 4. feutre émeraude tramé, éclairé au centre, imprimé (filets, losanges, soleil) ;
 * 5. anneau gravé en creux, bordé de deux filets de laiton, monogramme L en filigrane.
 * Le diamètre extérieur est celui de la disposition (`diameter`). `ring` / `ringBorder` :
 * diamètre et trait de l'anneau gravé (voir `centerCircles`). Mémoïsée : ses props sont des
 * nombres stables, elle ne se redessine pas à chaque mise à jour de la partie.
 */
export const WoodTable = memo(function WoodTable({
  diameter,
  ring = diameter * 0.54,
  ringBorder = Math.max(3, diameter * 0.044),
}: {
  diameter: number;
  ring?: number;
  ringBorder?: number;
}) {
  const fonts = useTableFonts();
  const rim = Math.max(6, Math.round(diameter * 0.075));
  const felt = diameter - rim * 2;
  // Le cuir occupe l'extérieur du bord ; le noyer, la bande fine contre le feutre.
  const band = Math.max(2, Math.round(rim * 0.3));
  const rail = rim - band;
  const wood = felt + band * 2;
  const pool = Math.round(diameter * 1.55);
  const lampOn = useLampOn();
  return (
    <View style={{ width: diameter, height: diameter }}>
      <Animated.View
        style={[
          styles.lampPool,
          {
            width: pool,
            height: pool,
            borderRadius: pool / 2,
            left: (diameter - pool) / 2,
            top: (diameter - pool) / 2,
            opacity: lampOn,
          },
        ]}
      />
      <View
        style={[
          styles.table,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            boxShadow: `0 ${Math.round(diameter * 0.05)}px ${Math.round(diameter * 0.12)}px rgba(0, 0, 0, 0.7), 0 0 0 1px ${t.leather.edge}, inset 0 ${Math.max(2, Math.round(rail * 0.18))}px ${Math.max(3, Math.round(rail * 0.3))}px rgba(255, 190, 170, 0.22), inset 0 -${Math.max(3, Math.round(rail * 0.25))}px ${Math.max(4, Math.round(rail * 0.45))}px rgba(0, 0, 0, 0.6)`,
          },
        ]}
      >
        <RailDetails diameter={diameter} rail={rail} />
        <View
          style={[
            styles.wood,
            {
              left: (diameter - wood) / 2,
              top: (diameter - wood) / 2,
              width: wood,
              height: wood,
              borderRadius: wood / 2,
            },
          ]}
        />
        <View
          style={[
            styles.inlay,
            {
              left: (diameter - felt) / 2 - 1.5,
              top: (diameter - felt) / 2 - 1.5,
              width: felt + 3,
              height: felt + 3,
              borderRadius: (felt + 3) / 2,
            },
          ]}
        />
        <View
          style={[
            styles.feltTop,
            {
              left: rim,
              top: rim,
              width: felt,
              height: felt,
              borderRadius: felt / 2,
              boxShadow: `inset 0 ${Math.round(felt * 0.03)}px ${Math.round(felt * 0.09)}px ${t.felt.shade}, inset 0 0 0 1px rgba(0, 0, 0, 0.45)`,
            },
          ]}
        >
          <FeltWeave size={felt} />
          <View style={[StyleSheet.absoluteFill, styles.feltLight]} />
          <FeltPrint felt={felt} ring={ring} />
          <View
            testID="table-ring"
            style={[
              styles.engraving,
              {
                width: ring,
                height: ring,
                borderRadius: ring / 2,
                borderWidth: ringBorder,
              },
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[styles.engravedLetter, fontOf(fonts.title), { fontSize: ring * 0.46 }]}
            >
              {BRAND_INITIAL}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'none' },
  room: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: t.room.base,
    experimental_backgroundImage: t.room.light,
  },
  // Bords de la pièce assombris : le regard revient vers la table éclairée.
  vignette: {
    experimental_backgroundImage:
      'radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0) 46%, rgba(0, 0, 0, 0.62) 100%)',
  },
  lampPool: {
    position: 'absolute',
    pointerEvents: 'none',
    experimental_backgroundImage: t.lamp.pool,
  },
  table: {
    overflow: 'hidden',
    backgroundColor: t.leather.base,
    experimental_backgroundImage: t.leather.surface,
  },
  // Bande de noyer verni, entre le cuir et le feutre.
  wood: {
    position: 'absolute',
    backgroundColor: t.rim.base,
    experimental_backgroundImage: t.rim.wood,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.6), 0 2px 4px rgba(0, 0, 0, 0.5)',
  },
  // Filet de laiton incrusté dans le noyer, contre le feutre.
  inlay: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: t.brass.main,
    boxShadow: `0 0 6px ${t.brass.faint}`,
  },
  feltTop: {
    position: 'absolute',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.felt.base,
    experimental_backgroundImage: t.felt.surface,
  },
  // Lumière de la lampe sur le feutre (le centre est plus clair, les bords plus sombres).
  feltLight: {
    experimental_backgroundImage:
      'radial-gradient(circle at 50% 42%, rgba(200, 255, 225, 0.17) 0%, rgba(200, 255, 225, 0.05) 40%, rgba(0, 0, 0, 0.18) 100%)',
  },
  // Anneau gravé en creux dans le feutre : sillon sombre bordé de deux filets de laiton.
  engraving: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: t.print.groove,
    boxShadow: `0 0 0 1px ${t.print.line}, inset 0 0 0 1px ${t.print.line}, inset 0 3px 10px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(200, 255, 225, 0.08)`,
  },
  engravedLetter: { color: 'rgba(226, 196, 120, 0.2)', includeFontPadding: false },
});
