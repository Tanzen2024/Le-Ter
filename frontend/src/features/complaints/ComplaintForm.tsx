import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { tablePalette as palette } from '../../components/table/TableDecor';
import { ApiError } from '../../lib/api-client';
import {
  COMPLAINT_CATEGORIES,
  type ComplaintCategory,
  type ComplaintDraft,
  type ComplaintLinks,
} from '../../types/complaint';
import { PanelButton } from '../lobby/LobbyUi';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { useComplaintMessages } from './complaint-messages';
import { Body, Card, Chip, Field, Heading } from './ComplaintUi';
import { useCreateComplaint } from './hooks';

/**
 * Dépôt d'une réclamation officielle. Le brouillon de l'assistant (catégorie, titre,
 * description, éléments VÉRIFIÉS comme appartenant au joueur) est modifiable : la catégorie
 * proposée n'est qu'une suggestion.
 */
export function ComplaintForm({
  draft,
  conversationId,
  onCreated,
  onCancel,
}: {
  draft: ComplaintDraft | null;
  conversationId: string | null;
  onCreated: (id: string, reference: string) => void;
  onCancel: () => void;
}) {
  const t = useComplaintMessages();
  const m = useLobbyMetrics();
  const create = useCreateComplaint();
  const [category, setCategory] = useState<ComplaintCategory>(draft?.category ?? 'OTHER');
  const [title, setTitle] = useState(draft?.title ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  // Éléments liés (assistant ou raccourci d'une partie / d'un tournoi) : retirables, et vérifiés
  // par le serveur au dépôt (un élément qui n'est pas au joueur est refusé, jamais deviné).
  const [links, setLinks] = useState<ComplaintLinks>(draft?.links ?? {});
  const error = create.error;
  const fields = error instanceof ApiError ? error.fields : {};
  const linkRejected = error instanceof ApiError && error.code === 'COMPLAINT_LINK_INVALID';
  const linkLabels: Record<keyof ComplaintLinks, string> = {
    gameId: t.form.linkGame,
    tournamentId: t.form.linkTournament,
    paymentId: t.form.linkPayment,
    withdrawalId: t.form.linkWithdrawal,
    walletTransactionId: t.form.linkTransaction,
  };
  const linked = (Object.keys(links) as (keyof ComplaintLinks)[]).filter((k) => links[k]);

  const submit = () =>
    create.mutate(
      {
        category,
        title: title.trim(),
        description: description.trim(),
        ...(linked.length > 0 && { links }),
        ...(conversationId && { conversationId }),
      },
      {
        onSuccess: (detail) => onCreated(detail.complaint.id, detail.complaint.reference),
      },
    );

  return (
    <ScrollView contentContainerStyle={{ gap: m.gap * 0.7 }}>
      <Card>
        <Heading>{t.form.title}</Heading>
        <Body muted>{t.form.category}</Body>
        {draft ? <Body muted>{t.form.categoryHint}</Body> : null}
        <View style={styles.wrap} accessibilityRole="radiogroup">
          {COMPLAINT_CATEGORIES.map((value) => (
            <Chip
              key={value}
              label={t.categories[value]}
              selected={category === value}
              onPress={() => setCategory(value)}
            />
          ))}
        </View>
        <Body muted>{t.form.subject}</Body>
        <Field
          value={title}
          onChangeText={setTitle}
          placeholder={t.form.subject}
          maxLength={120}
          accessibilityLabel={t.form.subject}
        />
        {fields.title ? <Text style={styles.error}>{fields.title}</Text> : null}
        <Body muted>{t.form.description}</Body>
        <Field
          value={description}
          onChangeText={setDescription}
          placeholder={t.form.description}
          multiline
          maxLength={4000}
          accessibilityLabel={t.form.description}
        />
        {fields.description ? <Text style={styles.error}>{fields.description}</Text> : null}
        {linked.length > 0 ? (
          <View testID="complaint-links" style={{ gap: m.gap * 0.3 }}>
            <Body muted>{t.form.linked}</Body>
            {linked.map((name) => (
              <View key={name} style={[styles.row, { gap: m.gap * 0.5 }]}>
                <Body>
                  {linkLabels[name]} · {String(links[name]).slice(0, 8)}
                </Body>
                <PanelButton
                  title={t.form.unlink}
                  tone="danger"
                  accessibilityLabel={`${t.form.unlink} : ${linkLabels[name]}`}
                  onPress={() => {
                    create.reset();
                    setLinks(({ [name]: _removed, ...rest }) => rest);
                  }}
                />
              </View>
            ))}
          </View>
        ) : null}
        {linkRejected ? <Text style={styles.error}>{t.form.linkInvalid}</Text> : null}
        {error && !linkRejected && !fields.title && !fields.description ? (
          <Text style={styles.error}>{error.message}</Text>
        ) : null}
        <View style={[styles.row, { gap: m.gap * 0.5 }]}>
          <PanelButton title={t.form.submit} loading={create.isPending} onPress={submit} />
          <PanelButton title={t.form.cancel} tone="danger" onPress={onCancel} />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  error: { color: palette.error },
});
