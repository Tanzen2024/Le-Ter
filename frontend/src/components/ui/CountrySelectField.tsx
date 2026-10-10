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

import { colors, spacing } from '../../constants/theme';
import { findPhoneCountry, searchPhoneCountries } from '../../lib/phone-countries';
import { PickerAction, pickerColors, PickerModal, PickerTrigger } from './PickerModal';

/**
 * Champ Pays de l'inscription (apparence claire des champs `soft`) : ouvre la fenêtre des
 * sélecteurs avec une recherche par nom (sans casse ni accents). Chaque option n'affiche QUE
 * le nom du pays : ni drapeau, ni indicatif, ni code, ni devise.
 */
export function CountrySelectField({
  label,
  value,
  onChange,
  error,
  placeholder,
  dense = false,
}: {
  label: string;
  /** Code ISO du pays choisi, `''` si aucun. */
  value: string;
  onChange: (code: string) => void;
  error?: string;
  placeholder?: string;
  dense?: boolean;
}) {
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
    <View style={[styles.container, dense && styles.containerDense]}>
      <Text style={styles.label}>{label}</Text>
      <PickerTrigger
        testID="country-select"
        label={label}
        hint="Ouvre la liste des pays"
        display={selected?.name}
        placeholder={placeholder}
        icon="▾"
        invalid={Boolean(error)}
        onPress={() => setOpen(true)}
        style={[styles.row, dense && styles.rowDense, error ? styles.rowError : null]}
        textStyle={styles.text}
      />
      {error ? (
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
            { width: Math.min(380, width - 48), height: Math.min(340, height * 0.6) },
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
  error: { color: colors.danger, fontSize: 12.5, lineHeight: 17, marginTop: spacing.xs },
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
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8 },
  optionActive: { backgroundColor: pickerColors.selected },
  optionText: { color: pickerColors.text, fontSize: 15 },
  optionTextActive: { color: pickerColors.selectedText, fontWeight: '700' },
  empty: { color: pickerColors.muted, textAlign: 'center', paddingVertical: 12 },
  pressed: { opacity: 0.75 },
});
