import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { fontOf, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { ApiError } from '../../lib/api-client';
import type { TournamentSummary } from '../../types/tournament';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { LobbyShell } from '../lobby/LobbyShell';
import { ChoiceGroup, InnerFrame, LobbyPanel, PanelButton } from '../lobby/LobbyUi';
import { useMyTournaments, useProposalAction, useProposeTournament } from './hooks';
import { proposalStatus, type ProposalTone } from './proposal-status';
import {
  defaultShares,
  defaultTournamentForm,
  fieldErrorsFromApi,
  MAX_RANKS,
  sharesTotal,
  toTournamentPayload,
  type TournamentFormErrors,
  type TournamentFormField,
  type TournamentFormValues,
} from './tournament-form';
import { formatFcfa, formatTournamentPeriod } from './tournament-state';

type Tab = 'new' | 'mine';

/**
 * Proposer un tournoi (route /tournament/propose, D-054) : formulaire et suivi de mes
 * propositions. Le serveur décide de tout (limites, approbation, statut) ; l'écran ne fait
 * que mettre en forme la saisie et afficher ses réponses.
 */
export function ProposeTournamentScreen() {
  const back = () => (router.canGoBack() ? router.back() : router.replace('/tournament'));
  const [tab, setTab] = useState<Tab>('new');
  const m = useLobbyMetrics();
  return (
    <LobbyShell onBack={back}>
      <LobbyPanel title="Proposer un tournoi" onClose={back} width={Math.max(560, m.width * 0.72)}>
        <View style={[styles.tabs, { marginBottom: m.gap }]}>
          <ChoiceGroup>
            <PanelButton
              title="Nouvelle proposition"
              selected={tab === 'new'}
              onPress={() => setTab('new')}
            />
            <PanelButton
              title="Mes propositions"
              selected={tab === 'mine'}
              onPress={() => setTab('mine')}
            />
          </ChoiceGroup>
        </View>
        {tab === 'new' ? <ProposalForm onSaved={() => setTab('mine')} /> : <MyProposals />}
      </LobbyPanel>
    </LobbyShell>
  );
}

export function ProposalForm({ onSaved }: { onSaved: () => void }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const [values, setValues] = useState<TournamentFormValues>(() => defaultTournamentForm());
  const [errors, setErrors] = useState<TournamentFormErrors>({});
  const propose = useProposeTournament();
  const apiError = propose.error instanceof ApiError ? propose.error : undefined;

  const set = (field: Exclude<TournamentFormField, 'shares'>) => (text: string) => {
    setValues((v) => ({ ...v, [field]: text }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const setRanks = (count: number) => {
    setValues((v) => ({ ...v, shares: defaultShares(count) }));
    setErrors((e) => ({ ...e, shares: undefined }));
  };
  const setShare = (index: number) => (text: string) => {
    setValues((v) => ({
      ...v,
      shares: v.shares.map((s, i) => (i === index ? text : s)),
    }));
    setErrors((e) => ({ ...e, shares: undefined }));
  };

  const send = (submit: boolean) => {
    const parsed = toTournamentPayload(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    propose.mutate(
      { input: parsed.payload, submit },
      {
        onSuccess: () => {
          setValues(defaultTournamentForm());
          setErrors({});
          onSaved();
        },
        onError: (err) => {
          if (err instanceof ApiError) setErrors(fieldErrorsFromApi(err.fields));
        },
      },
    );
  };

  const label = [styles.label, fontOf(fonts.button), { fontSize: m.smallSize }];
  const field = (
    key: Exclude<TournamentFormField, 'shares'>,
    title: string,
    props: TextInputProps = {},
  ) => (
    <View style={styles.field}>
      <Text style={label}>{title}</Text>
      <PanelInput
        accessibilityLabel={title}
        value={values[key]}
        onChangeText={set(key)}
        invalid={Boolean(errors[key])}
        {...props}
      />
      {errors[key] ? (
        <Text style={[styles.error, { fontSize: m.smallSize }]}>{errors[key]}</Text>
      ) : null}
    </View>
  );

  return (
    <InnerFrame style={{ gap: m.gap * 0.7 }}>
      <View style={[styles.row, { gap: m.gap }]}>
        {field('date', 'Date (JJ/MM/AAAA)', { placeholder: '12/10/2026' })}
        {field('startTime', 'Heure de début', { placeholder: '18:00' })}
        {field('durationMinutes', 'Durée (minutes)', {
          keyboardType: 'number-pad',
        })}
      </View>
      <View style={[styles.row, { gap: m.gap }]}>
        {field('entryFee', 'Participation (FCFA)', {
          keyboardType: 'number-pad',
        })}
        {field('minimumPlayers', 'Joueurs minimum', {
          keyboardType: 'number-pad',
        })}
        {field('maximumPlayers', 'Joueurs maximum', {
          keyboardType: 'number-pad',
          placeholder: 'Sans limite',
        })}
      </View>

      <View style={styles.field}>
        <Text style={label}>{`Rangs récompensés : ${values.shares.length}`}</Text>
        <View style={[styles.row, { gap: m.gap * 0.5 }]}>
          <PanelButton
            title="−"
            accessibilityLabel="Un rang récompensé de moins"
            disabled={values.shares.length <= 1}
            onPress={() => setRanks(values.shares.length - 1)}
          />
          <PanelButton
            title="+"
            accessibilityLabel="Un rang récompensé de plus"
            disabled={values.shares.length >= MAX_RANKS}
            onPress={() => setRanks(values.shares.length + 1)}
          />
          <Text style={label}>{`Total : ${sharesTotal(values.shares)} %`}</Text>
        </View>
        <View style={[styles.row, styles.wrap, { gap: m.gap * 0.5 }]}>
          {values.shares.map((share, index) => (
            <View key={index} style={styles.share}>
              <Text style={label}>{`${index + 1}${index === 0 ? 'er' : 'e'} (%)`}</Text>
              <PanelInput
                accessibilityLabel={`Part du rang ${index + 1} (%)`}
                value={share}
                onChangeText={setShare(index)}
                keyboardType="decimal-pad"
                invalid={Boolean(errors.shares)}
              />
            </View>
          ))}
        </View>
        {errors.shares ? (
          <Text style={[styles.error, { fontSize: m.smallSize }]}>{errors.shares}</Text>
        ) : null}
      </View>

      <Text style={[styles.hint, fontOf(fonts.button), { fontSize: m.smallSize }]}>
        Votre proposition sera vérifiée par l’administration avant publication. Les inscrits
        réservent la participation ; elle n’est débitée qu’au démarrage du tournoi.
      </Text>
      {apiError && !Object.keys(apiError.fields).length ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {apiError.message}
        </Text>
      ) : null}
      <View style={[styles.row, styles.actions, { gap: m.gap }]}>
        <PanelButton
          title="Enregistrer le brouillon"
          onPress={() => send(false)}
          disabled={propose.isPending}
        />
        <PanelButton title="Proposer" onPress={() => send(true)} loading={propose.isPending} />
      </View>
    </InnerFrame>
  );
}

export function MyProposals() {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { data, isPending, error } = useMyTournaments();
  const action = useProposalAction();
  const text = [styles.label, fontOf(fonts.button), { fontSize: m.smallSize }];

  if (isPending) return <Text style={text}>Chargement…</Text>;
  if (error) return <Text style={[styles.error, { fontSize: m.smallSize }]}>{error.message}</Text>;
  if (!data?.length) {
    return <Text style={text}>Vous n’avez encore proposé aucun tournoi.</Text>;
  }
  return (
    <View style={{ gap: m.gap * 0.6 }}>
      {action.error ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {action.error.message}
        </Text>
      ) : null}
      {data.map((t) => (
        <ProposalRow key={t.tournamentId} tournament={t} action={action} />
      ))}
    </View>
  );
}

function ProposalRow({
  tournament: t,
  action,
}: {
  tournament: TournamentSummary;
  action: ReturnType<typeof useProposalAction>;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const status = proposalStatus(t);
  const period = formatTournamentPeriod(t, 'fr-FR');
  const text = [styles.label, fontOf(fonts.button), { fontSize: m.smallSize }];
  const busy = action.isPending && action.variables?.tournamentId === t.tournamentId;
  return (
    <InnerFrame style={{ gap: 4 }}>
      <View style={[styles.row, styles.between]}>
        <Text style={[styles.name, fontOf(fonts.button), { fontSize: m.bodySize }]}>
          {`📅 ${period.date}`}
        </Text>
        <Text
          testID={`proposal-status-${t.tournamentId}`}
          style={[
            styles.badge,
            TONES[status.tone],
            fontOf(fonts.button),
            { fontSize: m.smallSize },
          ]}
        >
          {status.label}
        </Text>
      </View>
      <Text style={text}>
        {`🕐 ${period.start} — ${period.end} · 💰 ${formatFcfa(t.entryFee)}`}
      </Text>
      <Text style={text}>{status.explanation}</Text>
      {(status.canSubmit || status.canWithdraw) && (
        <View style={[styles.row, { gap: m.gap * 0.5 }]}>
          {status.canSubmit && (
            <PanelButton
              title="Soumettre"
              loading={busy && action.variables?.action === 'submit'}
              onPress={() =>
                action.mutate({
                  tournamentId: t.tournamentId,
                  action: 'submit',
                })
              }
            />
          )}
          {status.canWithdraw && (
            <PanelButton
              title="Retirer"
              tone="danger"
              loading={busy && action.variables?.action === 'withdraw'}
              onPress={() =>
                action.mutate({
                  tournamentId: t.tournamentId,
                  action: 'withdraw',
                })
              }
            />
          )}
        </View>
      )}
    </InnerFrame>
  );
}

/** Champ sombre des panneaux (même apparence que « Partie privée »). */
function PanelInput({ invalid, style, ...props }: TextInputProps & { invalid?: boolean }) {
  const m = useLobbyMetrics();
  return (
    <TextInput
      placeholderTextColor="rgba(235, 235, 235, 0.6)"
      autoCorrect={false}
      aria-invalid={invalid}
      style={[
        styles.input,
        { height: Math.max(40, m.controlHeight * 0.85), fontSize: m.smallSize },
        invalid && styles.inputInvalid,
        style,
      ]}
      {...props}
    />
  );
}

const TONES: Record<ProposalTone, { backgroundColor: string }> = {
  neutral: { backgroundColor: 'rgba(247, 241, 225, 0.16)' },
  pending: { backgroundColor: '#8A6A12' },
  success: { backgroundColor: tablePalette.jade },
  danger: { backgroundColor: tablePalette.danger },
};

const styles = StyleSheet.create({
  tabs: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  actions: { justifyContent: 'flex-end', flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 120, gap: 4 },
  share: { width: 72, gap: 2 },
  label: { color: '#FFFFFF' },
  hint: { color: tablePalette.cream, opacity: 0.85 },
  name: { color: tablePalette.gold, flexShrink: 1 },
  badge: {
    color: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  input: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: '#555555',
    experimental_backgroundImage: 'linear-gradient(180deg, #666666 0%, #4A4A4A 100%)',
    paddingHorizontal: 10,
    paddingVertical: 0,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  inputInvalid: { borderColor: tablePalette.error },
  error: { color: tablePalette.error },
});
