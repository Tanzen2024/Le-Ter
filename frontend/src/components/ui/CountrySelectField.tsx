import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, gameTheme, salon, spacing } from '../../constants/theme';
import { findPhoneCountry, flagEmoji, searchPhoneCountries } from '../../lib/phone-countries';
import { PickerAction, pickerColors, PickerModal, PickerTrigger } from './PickerModal';

/**
 * Champ Pays (inscription, connexion par téléphone, récupération) : ouvre la fenêtre des
 * sélecteurs avec une recherche par nom (sans casse ni accents). Chaque option n'affiche QUE
 * le nom du pays : ni drapeau, ni indicatif, ni code, ni devise. Apparence claire des champs
 * `soft`, pilule sombre des champs `table`, `inline` : indicatif seul (« +237 ▾ »), posé
 * au début d'un champ (sans libellé au-dessus ni cadre propre), ou `login` : le même indicatif
 * dans son propre cadre, posé à gauche d'un champ `login` (Connexion, Inscription).
 */
export function CountrySelectField({
  label,
  value,
  onChange,
  error,
  placeholder,
  dense = false,
  appearance = 'soft',
  controlHeight = 44,
  flag = false,
}: {
  label: string;
  /** Code ISO du pays choisi, `''` si aucun. */
  value: string;
  onChange: (code: string) => void;
  error?: string;
  placeholder?: string;
  dense?: boolean;
  appearance?: 'soft' | 'table' | 'inline' | 'login';
  /** Hauteur de la pilule `table` ou du cadre `login` (celle des champs voisins). */
  controlHeight?: number;
  /** Apparence `inline` ou `login` : drapeau du pays choisi devant l'indicatif. */
  flag?: boolean;
}) {
  const table = appearance === 'table';
  const framed = appearance === 'login';
  const inline = appearance === 'inline' || framed;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { width, height } = useWindowDimensions();
  const selected = value ? findPhoneCountry(value) : undefined;
  const results = useMemo(() => searchPhoneCountries(query), [query]);
  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View
      style={
        framed ? styles.framed : inline ? styles.inline : table ? null : [styles.container, dense && styles.containerDense]
      }
    >
      {table || inline ? null : <Text style={styles.label}>{label}</Text>}
      {inline ? (
        // Bouton dédié, de largeur fixe : jamais réduit ni masqué par la saisie à côté.
        <Pressable
          testID="country-select"
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Ouvre la liste des pays"
          accessibilityValue={
            selected ? { text: `${selected.name} ${selected.dialCode}` } : undefined
          }
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.inlineRow,
            framed && [styles.framedRow, { height: Math.max(controlHeight, 44) }],
            pressed && styles.pressed,
          ]}
        >
          {flag && selected ? <CountryFlag code={selected.code} /> : null}
          <Text numberOfLines={1} allowFontScaling={false} style={styles.inlineText}>
            {selected?.dialCode ?? '+'}
          </Text>
          <Text
            allowFontScaling={false}
            style={styles.inlineIcon}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            ▾
          </Text>
        </Pressable>
      ) : (
        <PickerTrigger
          testID="country-select"
          label={label}
          hint="Ouvre la liste des pays"
          display={selected?.name}
          placeholder={placeholder ?? (table ? label : undefined)}
          icon="▾"
          invalid={Boolean(error)}
          onPress={() => setOpen(true)}
          style={
            table
              ? [
                  styles.tableRow,
                  {
                    height: controlHeight,
                    borderRadius: controlHeight / 2,
                    paddingHorizontal: controlHeight / 2,
                  },
                  error ? styles.tableRowError : null,
                ]
              : [styles.row, dense && styles.rowDense, error ? styles.rowError : null]
          }
          textStyle={table ? styles.tableText : styles.text}
          // Colonne étroite (à côté du téléphone) : un long nom de pays n'est jamais tronqué.
          // Pilule de hauteur fixe : une ligne, police réduite au besoin ; sinon jusqu'à 2 lignes.
          lines={table ? 1 : 2}
          shrinkToFit
        />
      )}
      {error && !table && !inline ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <PickerModal
        visible={open}
        title={label}
        onClose={close}
        actions={<PickerAction title="Annuler" onPress={close} />}
      >
        <View
          style={[
            styles.sheet,
            {
              width: Math.min(380, width - 48),
              height: Math.min(340, height * 0.6),
            },
          ]}
        >
          <TextInput
            accessibilityLabel="Rechercher un pays"
            placeholder="Rechercher un pays"
            placeholderTextColor={pickerColors.muted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.search}
          />
          <FlatList
            testID="country-options"
            data={results}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            renderItem={({ item }) => {
              const active = item.code === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onChange(item.code);
                    close();
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>
                    {item.name}
                  </Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>Aucun pays trouvé.</Text>}
          />
        </View>
      </PickerModal>
    </View>
  );
}

/**
 * Drapeau du pays choisi. Celui du Cameroun (pays par défaut) est dessiné : Windows n'affiche
 * pas les emojis drapeaux (il écrit « CM »). Les autres pays gardent l'emoji.
 */
function CountryFlag({ code }: { code: string }) {
  if (code === 'CM') {
    return (
      <Svg
        testID="country-flag-CM"
        width={24}
        height={16}
        viewBox="0 0 30 20"
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Rect x={0} y={0} width={10} height={20} fill="#007A5E" />
        <Rect x={10} y={0} width={10} height={20} fill="#CE1126" />
        <Rect x={20} y={0} width={10} height={20} fill="#FCD116" />
        <Path
          d="M15 6.7L15.74 8.98L18.14 8.98L16.2 10.39L16.94 12.67L15 11.26L13.06 12.67L13.8 10.39L11.86 8.98L14.26 8.98Z"
          fill="#FCD116"
        />
      </Svg>
    );
  }
  return (
    <Text
      allowFontScaling={false}
      style={styles.inlineFlag}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {flagEmoji(code)}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  containerDense: { marginBottom: spacing.sm },
  // Mêmes valeurs que le libellé et la ligne `soft` de TextField.
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2B3A33',
    letterSpacing: 0.2,
    marginBottom: spacing.xs,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: '#E1E7E2',
    borderRadius: 14,
    backgroundColor: '#F2F5F1',
  },
  rowDense: { minHeight: 48 },
  rowError: { borderColor: colors.danger, backgroundColor: '#FFF6F5' },
  text: { fontSize: 16, color: colors.text },
  // Mêmes valeurs que la ligne `table` de TextField (connexion).
  tableRow: {
    borderWidth: 1.5,
    borderColor: gameTheme.brass.line,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  tableRowError: { borderColor: '#FF8A7A' },
  tableText: { fontSize: 15, color: salon.text },
  // Indicatif au début du champ `login` de TextField, séparé de la saisie par un filet.
  inline: { alignSelf: 'stretch', flexShrink: 0 },
  inlineRow: {
    flex: 1,
    minWidth: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingLeft: 14,
    paddingRight: 10,
    borderRightWidth: 1,
    borderRightColor: gameTheme.brass.hairline,
  },
  // Indicatif dans son propre cadre, à gauche du champ : mêmes bordure et fond que `login`.
  framed: { flexShrink: 0 },
  framedRow: {
    flex: 0,
    minWidth: 104,
    paddingLeft: 12,
    borderWidth: 1,
    borderRightWidth: 1,
    borderColor: gameTheme.brass.hairline,
    borderRightColor: gameTheme.brass.hairline,
    borderRadius: salon.radius.control,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
  },
  inlineText: { fontSize: 16, fontWeight: '600', color: salon.text },
  inlineFlag: { fontSize: 18 },
  inlineIcon: { fontSize: 14, color: salon.brass.text },
  error: {
    color: colors.danger,
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  sheet: { gap: 8 },
  search: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: pickerColors.line,
    color: pickerColors.text,
    fontSize: 15,
  },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  optionActive: { backgroundColor: pickerColors.selected },
  optionText: { color: pickerColors.text, fontSize: 15 },
  optionTextActive: { color: pickerColors.selectedText, fontWeight: '700' },
  empty: {
    color: pickerColors.muted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  pressed: { opacity: 0.75 },
});
