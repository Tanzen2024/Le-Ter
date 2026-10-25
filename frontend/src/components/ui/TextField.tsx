import { forwardRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, gameTheme, radius, salon, spacing } from '../../constants/theme';

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
   * `login` : champ sombre aux coins arrondis de l'écran de connexion, halo doré au focus,
   * œil pour afficher le mot de passe ; libellé et erreur gérés comme pour `table`.
   */
  appearance?: 'default' | 'table' | 'soft' | 'login';
  /** Hauteur du champ en apparence `table` ou `login` (44 minimum). */
  controlHeight?: number;
  /** Élément interactif posé avant la saisie, dans le cadre du champ (apparence `login`). */
  leading?: ReactNode;
  /**
   * Apparence `login` : erreur sous le champ, et aide tant qu'il a le focus (inscription).
   * Sans lui, l'écran affiche lui-même un message unique (connexion).
   */
  messages?: boolean;
  /**
   * Préfixe fixe affiché DANS le champ, avant la saisie (ex. indicatif « +237 ») : un élément
   * distinct du `TextInput`, que l'utilisateur ne peut ni modifier ni supprimer.
   */
  prefix?: string;
  /** Libellé lu par les lecteurs d'écran pour le préfixe. */
  prefixAccessibilityLabel?: string;
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
    prefix,
    prefixAccessibilityLabel,
    leading,
    messages = false,
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
  const login = appearance === 'login';
  // Sans libellé visible ni message sous le champ : l'écran affiche un message unique.
  const bare = table || login;
  const tableHeight = Math.max(controlHeight, TABLE_MIN_HEIGHT);

  return (
    <View
      style={
        bare
          ? messages
            ? styles.loginContainer
            : null
          : [styles.container, dense && styles.containerDense]
      }
    >
      {bare ? null : <Text style={[styles.label, soft && styles.softLabel]}>{label}</Text>}
      <View
        style={
          login
            ? [
                styles.loginRow,
                { height: tableHeight },
                focused && styles.loginRowFocused,
                error ? styles.loginRowError : null,
              ]
            : table
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
                  inputProps.editable === false && styles.rowDisabled,
                ]
        }
      >
        {prefix ? (
          <View
            testID="text-field-prefix"
            accessible
            accessibilityLabel={prefixAccessibilityLabel ?? prefix}
            style={styles.prefix}
          >
            <Text style={styles.prefixText}>{prefix}</Text>
          </View>
        ) : null}
        {leading}
        <TextInput
          ref={ref}
          style={[
            login
              ? styles.loginInput
              : table
                ? [styles.tableInput, { paddingHorizontal: tableHeight / 2 }]
                : styles.input,
            !bare && dense && styles.inputDense,
            style,
          ]}
          placeholder={table ? (placeholder ?? label) : placeholder}
          placeholderTextColor={bare ? TABLE_PLACEHOLDER : colors.textMuted}
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
            style={[
              styles.toggle,
              table && { paddingRight: tableHeight / 2 },
              login && [styles.loginToggle, { width: tableHeight }],
            ]}
          >
            {login ? (
              <EyeIcon crossed={!revealed} />
            ) : (
              <Text style={[styles.toggleText, table && styles.tableToggleText]}>
                {revealed ? 'Masquer' : 'Afficher'}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
      {login && messages ? (
        error ? (
          <Text style={[styles.loginMessage, styles.loginError]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : hint && focused ? (
          <Text style={styles.loginMessage}>{hint}</Text>
        ) : null
      ) : bare ? null : error ? (
        <Text style={[styles.error, soft && styles.softMessage]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.hint, soft && styles.softMessage]}>{hint}</Text>
      ) : null}
    </View>
  );
});

/** Œil (barré tant que le mot de passe est masqué), purement décoratif : le bouton est libellé. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <Svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke={LOGIN_ICON}
      strokeWidth={1.8}
    >
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" strokeLinejoin="round" />
      <Circle cx={12} cy={12} r={3} />
      {crossed ? <Path d="M4 4l16 16" strokeLinecap="round" /> : null}
    </Svg>
  );
}

const TABLE_PLACEHOLDER = 'rgba(247, 241, 225, 0.55)';
const LOGIN_ICON = 'rgba(247, 241, 225, 0.75)';

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
  inputRowDense: { minHeight: 48 },
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
    borderColor: gameTheme.brass.line,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  tableRowFocused: { borderColor: gameTheme.brass.bright },
  tableRowError: { borderColor: '#FF8A7A' },
  tableInput: {
    flex: 1,
    alignSelf: 'stretch',
    paddingVertical: 0,
    color: salon.text,
  },
  tableToggleText: { color: salon.brass.text },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: gameTheme.brass.hairline,
    borderRadius: salon.radius.control,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.45)',
  },
  loginRowFocused: {
    borderColor: gameTheme.brass.bright,
    boxShadow: '0 0 0 3px rgba(214, 178, 94, 0.2)',
  },
  loginRowError: { borderColor: '#FF8A7A' },
  loginInput: {
    flex: 1,
    alignSelf: 'stretch',
    minWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 14,
    fontSize: 16,
    color: salon.text,
  },
  loginContainer: { gap: 4 },
  loginMessage: { color: 'rgba(247, 241, 225, 0.7)', fontSize: 12.5, lineHeight: 17 },
  loginError: { color: '#FFB3A6', fontWeight: '600' },
  loginToggle: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
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
  rowDisabled: { opacity: 0.6 },
  prefix: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRightWidth: 1.5,
    borderRightColor: '#E1E7E2',
  },
  prefixText: { fontSize: 16, fontWeight: '600', color: colors.text },
});
