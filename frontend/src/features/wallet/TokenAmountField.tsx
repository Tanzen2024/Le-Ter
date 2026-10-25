import { StyleSheet, Text, TextInput, View } from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { gameTheme, salon } from '../../constants/theme';
import { useLobbyMetrics } from '../lobby/lobby-metrics';

/**
 * Montant saisi À LA MAIN dans le panneau « Mes jetons » (aucun montant proposé). Le texte
 * brut est conservé tel quel pour que les contrôles existants (`checkDepositAmount`,
 * `checkWithdrawalAmount`) le jugent ; seul un nombre entier est AFFICHÉ par groupes de
 * milliers (« 12 500 »), les espaces étant retirés à la saisie.
 */
export function AmountField({
  label,
  unit,
  value,
  maxDigits,
  invalid,
  editable = true,
  height,
  onChange,
  onSubmit,
}: {
  label: string;
  unit: string;
  value: string;
  /** Longueur maximale du texte brut (sans les espaces d'affichage). */
  maxDigits: number;
  invalid: boolean;
  editable?: boolean;
  height: number;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  // Groupes du texte brut lui-même (un « 0 » de tête n'est jamais effacé en silence).
  const shown = /^\d+$/.test(value) ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : value;
  return (
    <View style={[styles.field, { height }, invalid && styles.fieldError]}>
      <TextInput
        value={shown}
        onChangeText={(text) => {
          const raw = text.replace(/\s/g, '');
          if (raw.length <= maxDigits) onChange(raw);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        editable={editable}
        placeholder="0"
        placeholderTextColor={salon.textFaint}
        accessibilityLabel={label}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        style={[styles.input, fontOf(fonts.button), { fontSize: m.bodySize * 1.45 }]}
      />
      <Text style={[styles.unit, fontOf(fonts.button), { fontSize: m.bodySize }]}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: gameTheme.brass.hairline,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  fieldError: { borderColor: palette.error },
  input: { flex: 1, paddingVertical: 0, textAlign: 'center', color: salon.text },
  unit: { color: salon.textSoft, marginLeft: 8 },
});
