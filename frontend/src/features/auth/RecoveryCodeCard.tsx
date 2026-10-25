import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/ui/Button';
import { gameTheme, salon, spacing } from '../../constants/theme';

/**
 * Code de récupération affiché UNE fois (D-135) : à l'inscription, après une
 * réinitialisation, ou depuis le Profil. Le code vient de la réponse du serveur qui l'a créé
 * et ne vit que dans l'état de l'écran : jamais écrit dans un stockage, jamais relu par une
 * autre API. « Copier le code » le met dans le presse-papiers du téléphone, à la demande.
 */
export function RecoveryCodeCard({
  code,
  title = 'Votre code de récupération',
  confirmTitle = 'J’ai enregistré mon code',
  onConfirm,
  confirming = false,
}: {
  code: string;
  title?: string;
  confirmTitle?: string;
  onConfirm: () => void;
  confirming?: boolean;
}) {
  const [copied, setCopied] = useState<'ok' | 'failed'>();
  const copy = async () => {
    try {
      setCopied((await Clipboard.setStringAsync(code)) ? 'ok' : 'failed');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <View style={styles.card} testID="recovery-code-card">
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text
        style={styles.code}
        selectable
        testID="recovery-code"
        accessibilityLabel={`Code de récupération : ${code.split('').join(' ')}`}
      >
        {code}
      </Text>
      <Text style={styles.text}>
        Conservez ce code précieusement. Il vous permettra de récupérer votre compte si vous
        oubliez votre mot de passe.
      </Text>
      <Text style={[styles.text, styles.warning]}>
        Ce code ne sera plus affiché après cette étape.
      </Text>
      <Button
        title="Copier le code"
        variant="secondary"
        appearance="salon"
        onPress={() => void copy()}
      />
      {copied ? (
        <Text style={styles.text} accessibilityLiveRegion="polite">
          {copied === 'ok'
            ? 'Code copié.'
            : 'Copie impossible : recopiez le code à la main.'}
        </Text>
      ) : null}
      <Button title={confirmTitle} appearance="salon" onPress={onConfirm} loading={confirming} />
    </View>
  );
}

// Posée sur les écrans sombres (inscription, mot de passe oublié, Profil) : texte clair, code
// gravé en laiton dans un creux, avertissement bien visible.
const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: salon.radius.card,
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: 'rgba(214, 178, 94, 0.08)',
  },
  title: { color: salon.text, fontSize: 16, fontWeight: '700' },
  code: {
    color: gameTheme.brass.bright,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: salon.surface.wellBorder,
    backgroundColor: salon.surface.well,
  },
  text: { color: salon.textSoft, fontSize: 13 },
  warning: { color: salon.status.critical.text, fontWeight: '600' },
});
