import { StyleSheet, View } from 'react-native';

import { CountrySelectField } from '../../components/ui/CountrySelectField';
import { TextField } from '../../components/ui/TextField';
import { AFTER_ICON, FieldIcon, UserIcon } from './AuthIcons';
import { useLoginMetrics } from './LoginLayout';
import { looksLikeEmail } from './validation';

/**
 * Ligne d'identification commune (Connexion, Mot de passe oublié) :
 * [ 🇨🇲 +237 ▾ ] [ 👤 Téléphone ou email ]. L'indicatif est un bloc distinct, à gauche ; il
 * s'estompe quand une adresse e-mail est saisie (il ne s'y applique pas).
 */
export function IdentifierField({
  country,
  value,
  error,
  messages = false,
  onCountryChange,
  onChangeText,
  onSubmitEditing,
}: {
  country: string;
  value: string;
  error?: string;
  /** Erreur affichée sous le champ (sinon l'écran affiche lui-même un message unique). */
  messages?: boolean;
  onCountryChange: (code: string) => void;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
}) {
  const { controlHeight, inputFontSize, gap } = useLoginMetrics();
  const email = looksLikeEmail(value);

  return (
    <View style={[styles.row, { gap: gap / 2 }]}>
      <View style={[styles.country, email && styles.countryUnused]}>
        <CountrySelectField
          appearance="login"
          flag
          controlHeight={controlHeight}
          label="Indicatif du pays"
          value={country}
          onChange={onCountryChange}
        />
      </View>
      <View style={styles.identifier}>
        <TextField
          appearance="login"
          messages={messages}
          controlHeight={controlHeight}
          style={[{ fontSize: inputFontSize }, AFTER_ICON, styles.input]}
          label="Téléphone ou email"
          placeholder="Téléphone ou email"
          value={value}
          onChangeText={onChangeText}
          error={error}
          leading={
            <FieldIcon>
              <UserIcon />
            </FieldIcon>
          }
          // Clavier texte : il doit accepter aussi bien « 695… » qu'une adresse e-mail.
          keyboardType="default"
          autoCapitalize="none"
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={onSubmitEditing}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // En haut de la ligne : un message d'erreur sous le champ ne décale pas l'indicatif.
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  country: { flexShrink: 0 },
  countryUnused: { opacity: 0.4 },
  identifier: { flex: 1, minWidth: 0 },
  // Saisie et placeholder alignés à gauche, juste après l'icône.
  input: { textAlign: 'left' },
});
