import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing } from '../../constants/theme';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  /** Champ mot de passe : masqué, avec un bouton afficher/masquer. */
  secret?: boolean;
  /** Version resserrée pour les écrans peu hauts (smartphone en paysage). */
  dense?: boolean;
  /**
   * `table` : champ pilule sombre posé sur le feutre (écran de connexion). Le libellé n'est
   * pas affiché (il sert de placeholder et reste annoncé par `accessibilityLabel`) et l'erreur
   * n'apparaît que par la bordure : l'écran affiche lui-même un message unique.
   * `soft` : champ clair et arrondi (inscription), halo vert au focus, fond teinté en erreur.
   */
  appearance?: 'default' | 'table' | 'soft';
  /** Hauteur du champ en apparence `table` (44 minimum). */
  controlHeight?: number;
}

const TABLE_MIN_HEIGHT = 44;

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    error,
    hint,
    secret = false,
    dense = false,
    appearance = 'default',
    controlHeight = TABLE_MIN_HEIGHT,
    style,
    onFocus,
    onBlur,
    placeholder,
    ...inputProps
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const table = appearance === 'table';
  const soft = appearance === 'soft';
  const tableHeight = Math.max(controlHeight, TABLE_MIN_HEIGHT);

  return (
    <View style={table ? null : [styles.container, dense && styles.containerDense]}>
      {table ? null : <Text style={[styles.label, soft && styles.softLabel]}>{label}</Text>}
      <View
        style={
          table
            ? [
                styles.tableRow,
                { height: tableHeight, borderRadius: tableHeight / 2 },
                focused && styles.tableRowFocused,
                error ? styles.tableRowError : null,
              ]
            : [
                styles.inputRow,
                dense && styles.inputRowDense,
                soft && styles.softRow,
                focused && styles.inputRowFocused,
                soft && focused && styles.softRowFocused,
                error ? styles.inputRowError : null,
                soft && error ? styles.softRowError : null,
              ]
        }
      >
        <TextInput
          ref={ref}
          style={[
            table ? [styles.tableInput, { paddingHorizontal: tableHeight / 2 }] : styles.input,
            !table && dense && styles.inputDense,
            style,
          ]}
          placeholder={table ? (placeholder ?? label) : placeholder}
          placeholderTextColor={table ? TABLE_PLACEHOLDER : colors.textMuted}
          secureTextEntry={secret && !revealed}
          autoCorrect={false}
          accessibilityLabel={label}
          aria-invalid={Boolean(error)}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...inputProps}
        />
        {secret ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            hitSlop={8}
            style={[styles.toggle, table && { paddingRight: tableHeight / 2 }]}
          >
            <Text style={[styles.toggleText, table && styles.tableToggleText]}>
              {revealed ? 'Masquer' : 'Afficher'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {table ? null : error ? (
        <Text style={[styles.error, soft && styles.softMessage]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.hint, soft && styles.softMessage]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const TABLE_PLACEHOLDER = 'rgba(247, 241, 225, 0.55)';

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  containerDense: { marginBottom: spacing.sm },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    minHeight: 52,
  },
  inputRowDense: { minHeight: 44 },
  inputRowFocused: { borderColor: colors.borderFocus },
  inputRowError: { borderColor: colors.danger },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  inputDense: { paddingVertical: 10, fontSize: 15 },
  toggle: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  toggleText: { color: colors.feltLight, fontWeight: '600', fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(242, 196, 81, 0.55)',
    backgroundColor: 'rgba(4, 24, 13, 0.55)',
  },
  tableRowFocused: { borderColor: '#F2C451' },
  tableRowError: { borderColor: '#FF8A7A' },
  tableInput: {
    flex: 1,
    alignSelf: 'stretch',
    paddingVertical: 0,
    color: '#F7F1E1',
  },
  tableToggleText: { color: '#F2C451' },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  softLabel: { fontSize: 13, color: '#2B3A33', letterSpacing: 0.2 },
  softRow: {
    borderWidth: 1.5,
    borderColor: '#E1E7E2',
    borderRadius: 14,
    backgroundColor: '#F2F5F1',
  },
  softRowFocused: {
    borderColor: colors.feltLight,
    backgroundColor: colors.surface,
    boxShadow: '0 0 0 3px rgba(22, 82, 63, 0.14)',
  },
  softRowError: {
    backgroundColor: '#FFF6F5',
    boxShadow: '0 0 0 3px rgba(179, 38, 30, 0.10)',
  },
  softMessage: { fontSize: 12.5, lineHeight: 17 },
});
