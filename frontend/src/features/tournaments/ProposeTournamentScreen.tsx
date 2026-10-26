import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { fontOf, tablePalette, useTableFonts } from '../../components/table/TableDecor';
import { EmptyState } from '../../components/ui/SalonParts';
import { gameTheme, salon, type SalonTone } from '../../constants/theme';
import { DatePickerField } from '../../components/ui/DatePickerField';
import { TimePickerField } from '../../components/ui/TimePickerField';
import { ApiError, userErrorMessage } from '../../lib/api-client';
import { playSound } from '../../services/audio-service';
import { todayOf } from '../../lib/date-time';
import type { TournamentCreationRules, TournamentSummary } from '../../types/tournament';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import { LobbyShell } from '../lobby/LobbyShell';
import { ChoiceGroup, InnerFrame, LobbyPanel, PanelButton } from '../lobby/LobbyUi';
import {
  useMyTournaments,
  useProposalAction,
  useProposeTournament,
  useTournamentRules,
} from './hooks';
import { proposalStatus, type ProposalTone } from './proposal-status';
import {
  GARAM_VARIANTS,
  garamVariantLabel,
  type GameType,
  type GaramVariant,
} from '../../types/game';
import {
  defaultShares,
  defaultTournamentForm,
  formErrorsFromApiError,
  generalApiError,
  MAX_RANKS,
  sharesTotal,
  toTournamentPayload,
  TOURNAMENT_GAMES,
  withRuleDefaults,
  type TournamentFormErrors,
  type TournamentFormValues,
  type TournamentTextField,
} from './tournament-form';
import { useTournamentMessages } from './tournament-messages';
import { formatFcfa, formatTournamentPeriod } from './tournament-state';

type Tab = 'new' | 'mine';

/**
 * Proposer un tournoi (route /tournament/propose, D-054) : formulaire et suivi de mes
 * propositions. Le serveur décide de tout (limites, approbation, statut) ; l'écran ne fait
 * que mettre en forme la saisie et afficher ses réponses.
 *
 * Tenu sans défiler en paysage, clavier fermé : champs regroupés en lignes compactes, et
 * « Enregistrer le brouillon » / « Proposer » dans la zone d'actions du panneau, hors du
 * défilement, toujours visible (même clavier ouvert). La saisie est conservée en passant
 * d'un onglet à l'autre.
 */
export function ProposeTournamentScreen() {
  const back = () => (router.canGoBack() ? router.back() : router.replace('/tournament'));
  const [tab, setTab] = useState<Tab>('new');
  const m = useLobbyMetrics();
  const form = useProposalForm({ onSaved: () => setTab('mine') });
  return (
    <LobbyShell onBack={back}>
      <LobbyPanel
        title="Proposer un tournoi"
        onClose={back}
        width={Math.max(560, m.width * 0.72)}
        footer={tab === 'new' ? form.actions : undefined}
      >
        <View style={[styles.tabs, { marginBottom: m.gap * 0.5 }]}>
          <ChoiceGroup>
            <PanelButton
              compact
              title="Nouvelle proposition"
              selected={tab === 'new'}
              onPress={() => setTab('new')}
            />
            <PanelButton
              compact
              title="Mes propositions"
              selected={tab === 'mine'}
              onPress={() => setTab('mine')}
            />
          </ChoiceGroup>
        </View>
        {tab === 'new' ? form.fields : <MyProposals />}
      </LobbyPanel>
    </LobbyShell>
  );
}

/** Formulaire autonome : les champs puis la zone d'actions (tests, autres conteneurs). */
export function ProposalForm({ onSaved }: { onSaved: () => void }) {
  const m = useLobbyMetrics();
  const form = useProposalForm({ onSaved });
  return (
    <View style={{ gap: m.gap * 0.6 }}>
      {form.fields}
      {form.actions}
    </View>
  );
}

/**
 * Formulaire de proposition : renvoie les champs et, séparément, les actions, pour que
 * l'écran pose ces dernières dans la zone d'actions de son panneau.
 */
export function useProposalForm({ onSaved }: { onSaved: () => void }): {
  fields: ReactNode;
  actions: ReactNode;
} {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const t = useTournamentMessages();
  const [values, setValues] = useState<TournamentFormValues>(() => defaultTournamentForm());
  const [errors, setErrors] = useState<TournamentFormErrors>({});
  // Règles réglées dans les Paramètres des tournois (D-103, D-104) : valeurs par défaut
  // ajustées dès leur lecture (sans toucher une saisie déjà modifiée), contrôle immédiat.
  const rules = useTournamentRules().data;
  const [appliedRules, setAppliedRules] = useState<TournamentCreationRules>();
  if (rules && rules !== appliedRules) {
    setAppliedRules(rules);
    setValues((v) => withRuleDefaults(v, rules));
  }
  const propose = useProposeTournament();
  const generalError = generalApiError(
    propose.error instanceof ApiError ? propose.error : undefined,
  );

  const set = (field: TournamentTextField) => (text: string) => {
    setValues((v) => ({ ...v, [field]: text }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };
  // Jeu du tournoi (D-124) : aucun choix au départ, un seul à la fois.
  const setGame = (gameType: GameType) => {
    // Changer de jeu remet la variante présélectionnée (15) : jamais de variante reportée.
    setValues((v) => ({ ...v, gameType, garamVariant: gameType === v.gameType ? v.garamVariant : 15 }));
    setErrors((e) => ({ ...e, gameType: undefined, garamVariant: undefined }));
  };
  // Variante d'un tournoi GARAM TIA (D-127) : choix explicite obligatoire.
  const setVariant = (garamVariant: GaramVariant) => {
    setValues((v) => ({ ...v, garamVariant }));
    setErrors((e) => ({ ...e, garamVariant: undefined }));
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
    // Une seule demande à la fois : un second appui pendant l'envoi est sans effet.
    if (propose.isPending) return;
    const parsed = toTournamentPayload(values, undefined, rules);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    propose.mutate(
      { input: parsed.payload, submit },
      {
        onSuccess: () => {
          setValues(
            rules ? withRuleDefaults(defaultTournamentForm(), rules) : defaultTournamentForm(),
          );
          setErrors({});
          onSaved();
        },
        onError: (err) => {
          if (err instanceof ApiError) setErrors(formErrorsFromApiError(err));
        },
      },
    );
  };

  // Compact : libellés au-dessus de champs un peu moins hauts, petits espacements ; les
  // espaces s'élargissent seulement sur les écrans hauts (tablette).
  const roomy = m.height >= 600;
  const inputHeight = roomy ? Math.max(40, m.controlHeight * 0.85) : Math.max(34, m.controlHeight * 0.8);
  const rowGap = roomy ? m.gap * 0.8 : m.gap * 0.45;
  const label = [styles.label, fontOf(fonts.button), { fontSize: m.smallSize }];
  const errorText = [styles.error, { fontSize: m.smallSize }];
  const fieldError = (message: string | undefined) =>
    message ? (
      <Text style={errorText} numberOfLines={2}>
        {message}
      </Text>
    ) : null;
  const field = (
    key: TournamentTextField,
    title: string,
    props: TextInputProps = {},
  ) => (
    <View style={styles.field}>
      {/* Libellé entier, réduit sur une ligne s'il le faut, jamais abrégé. */}
      <Text style={label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {title}
      </Text>
      <PanelInput
        accessibilityLabel={title}
        value={values[key]}
        onChangeText={set(key)}
        invalid={Boolean(errors[key])}
        height={inputHeight}
        {...props}
      />
      {fieldError(errors[key])}
    </View>
  );

  // Sélecteurs Date et Heure : même apparence que les champs texte du panneau ; calendrier et
  // horloge s'ouvrent accrochés à leur champ, sur l'écran courant (D-166).
  const pickerStyle = (key: 'date' | 'startTime') => [
    styles.input,
    { height: inputHeight },
    Boolean(errors[key]) && styles.inputInvalid,
  ];
  const pickerText = [styles.pickerText, { fontSize: m.smallSize }];

  const fields = (
    <View style={{ gap: rowGap }}>
      {/* Jeu (et variante GARAM TIA) : libellé devant le choix, sur une seule ligne. */}
      <View style={[styles.row, styles.wrap, { columnGap: m.gap * 1.2, rowGap }]}>
        <View style={[styles.inline, { gap: m.gap * 0.5 }]}>
          <Text style={label}>Jeu du tournoi *</Text>
          <ChoiceGroup>
            {TOURNAMENT_GAMES.map((game) => (
              <PanelButton
                key={game.value}
                compact
                title={game.label}
                selected={values.gameType === game.value}
                onPress={() => setGame(game.value)}
              />
            ))}
          </ChoiceGroup>
        </View>
        {values.gameType === 'GARAM' ? (
          <View style={[styles.inline, { gap: m.gap * 0.5 }]}>
            <Text style={label}>Variante *</Text>
            <ChoiceGroup>
              {GARAM_VARIANTS.map((variant) => (
                <PanelButton
                  key={variant}
                  compact
                  title={garamVariantLabel(variant)}
                  selected={values.garamVariant === variant}
                  onPress={() => setVariant(variant)}
                />
              ))}
            </ChoiceGroup>
          </View>
        ) : null}
      </View>
      {errors.gameType || errors.garamVariant ? (
        <Text accessibilityRole="alert" style={errorText}>
          {errors.gameType ?? errors.garamVariant}
        </Text>
      ) : null}

      <View style={[styles.row, styles.top, { gap: m.gap }]}>
        <View style={styles.field}>
          <Text style={label} numberOfLines={1}>
            {t.form.date}
          </Text>
          <DatePickerField
            label={t.form.date}
            value={values.date}
            onChange={set('date')}
            minDate={todayOf()}
            presentation="popover"
            invalid={Boolean(errors.date)}
            style={pickerStyle('date')}
            textStyle={pickerText}
          />
          {fieldError(errors.date)}
        </View>
        <View style={styles.field}>
          <Text style={label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {t.form.startTime}
          </Text>
          <TimePickerField
            label={t.form.startTime}
            value={values.startTime}
            onChange={set('startTime')}
            presentation="popover"
            invalid={Boolean(errors.startTime)}
            style={pickerStyle('startTime')}
            textStyle={pickerText}
          />
          {fieldError(errors.startTime)}
        </View>
        {field('durationMinutes', 'Durée (minutes)', {
          keyboardType: 'number-pad',
        })}
      </View>
      <View style={[styles.row, styles.top, { gap: m.gap }]}>
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

      {/* Rangs récompensés : libellé seul sur sa ligne, puis les boutons − / + et le total
          juste en dessous, puis les parts (%). */}
      <View style={[styles.ranks, { gap: m.gap * 0.5, padding: m.gap * 0.7 }]}>
        <Text style={label}>{`Rangs récompensés : ${values.shares.length}`}</Text>
        <View style={[styles.row, { gap: m.gap * 0.5 }]}>
          <StepButton
            symbol="−"
            accessibilityLabel="Un rang récompensé de moins"
            disabled={values.shares.length <= 1}
            onPress={() => setRanks(values.shares.length - 1)}
          />
          <StepButton
            symbol="+"
            accessibilityLabel="Un rang récompensé de plus"
            disabled={values.shares.length >= MAX_RANKS}
            onPress={() => setRanks(values.shares.length + 1)}
          />
          {/* Repère visuel : la somme attendue est 100 % (vérifiée par le serveur). */}
          <Text
            style={[
              styles.totalBadge,
              toneOf(sharesTotal(values.shares) === 100 ? 'positive' : 'attention'),
              fontOf(fonts.button),
              { fontSize: m.smallSize },
            ]}
          >
            {`Total : ${sharesTotal(values.shares)} %`}
          </Text>
        </View>
        <View style={[styles.row, styles.wrap, { gap: m.gap * 0.5 }]}>
          {values.shares.map((share, index) => (
            <View
              key={index}
              style={[styles.inline, styles.share, styles.shareChip, rankChip(index), { gap: 4 }]}
            >
              <Text style={label}>{`${index + 1}${index === 0 ? 'er' : 'e'}`}</Text>
              <PanelInput
                accessibilityLabel={`Part du rang ${index + 1} (%)`}
                value={share}
                onChangeText={setShare(index)}
                keyboardType="decimal-pad"
                invalid={Boolean(errors.shares)}
                height={inputHeight}
                style={styles.shareInput}
              />
              <Text style={label}>%</Text>
            </View>
          ))}
        </View>
        {fieldError(errors.shares)}
      </View>

      <Text style={[styles.hint, fontOf(fonts.button), { fontSize: m.smallSize }]}>
        Votre proposition sera vérifiée par l’administration avant publication. Les inscrits
        réservent la participation ; elle n’est débitée qu’au démarrage du tournoi.
      </Text>
    </View>
  );

  // Zone d'actions : « Proposer », action principale (émeraude cerclée de laiton) ;
  // « Enregistrer le brouillon », secondaire. Erreur générale juste au-dessus des boutons.
  const actions = (
    <View style={{ gap: m.gap * 0.4 }}>
      {generalError ? (
        <Text accessibilityRole="alert" numberOfLines={2} style={errorText}>
          {generalError}
        </Text>
      ) : null}
      <View style={[styles.row, styles.actions, { gap: m.gap }]}>
        <PanelButton
          title="Enregistrer le brouillon"
          tone="quiet"
          onPress={() => send(false)}
          disabled={propose.isPending}
          loading={propose.isPending && propose.variables?.submit === false}
        />
        <PanelButton
          title="Proposer"
          tone="primary"
          onPress={() => send(true)}
          disabled={propose.isPending}
          loading={propose.isPending && propose.variables?.submit !== false}
        />
      </View>
    </View>
  );
  return { fields, actions };
}

export function MyProposals() {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { data, isPending, error } = useMyTournaments();
  const action = useProposalAction();
  const text = [styles.label, fontOf(fonts.button), { fontSize: m.smallSize }];

  if (isPending) return <Text style={text}>Chargement…</Text>;
  if (error) {
    const message = userErrorMessage(error);
    return message ? <Text style={[styles.error, { fontSize: m.smallSize }]}>{message}</Text> : null;
  }
  if (!data?.length) {
    return (
      <EmptyState
        glyph="📝"
        title="Vous n’avez encore proposé aucun tournoi."
        size={m.smallSize}
        fontFamily={fonts.button}
      />
    );
  }
  return (
    <View style={{ gap: m.gap * 0.6 }}>
      {userErrorMessage(action.error) ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {userErrorMessage(action.error)}
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
function PanelInput({
  invalid,
  height,
  style,
  ...props
}: TextInputProps & { invalid?: boolean; height?: number }) {
  const m = useLobbyMetrics();
  return (
    <TextInput
      placeholderTextColor={salon.textFaint}
      autoCorrect={false}
      aria-invalid={invalid}
      style={[
        styles.input,
        { height: height ?? Math.max(40, m.controlHeight * 0.85), fontSize: m.smallSize },
        invalid && styles.inputInvalid,
        style,
      ]}
      {...props}
    />
  );
}

/**
 * Fond de la pastille d'un rang récompensé : or (1er), argent (2e), bronze (3e), puis deux
 * teintes douces qui alternent (jade, bleu nuit) pour distinguer les rangs voisins.
 * Présentation seulement.
 */
const RANK_CHIPS = [
  { backgroundColor: 'rgba(245, 200, 66, 0.2)', borderColor: 'rgba(245, 200, 66, 0.6)' },
  { backgroundColor: 'rgba(205, 214, 224, 0.16)', borderColor: 'rgba(205, 214, 224, 0.55)' },
  { backgroundColor: 'rgba(205, 127, 50, 0.2)', borderColor: 'rgba(205, 127, 50, 0.6)' },
] as const;
const RANK_CHIPS_ALTERNATE = [
  { backgroundColor: 'rgba(67, 196, 158, 0.12)', borderColor: 'rgba(67, 196, 158, 0.38)' },
  { backgroundColor: 'rgba(110, 150, 215, 0.13)', borderColor: 'rgba(110, 150, 215, 0.4)' },
] as const;
const rankChip = (index: number) =>
  RANK_CHIPS[index] ?? RANK_CHIPS_ALTERNATE[(index - RANK_CHIPS.length) % 2]!;

/** Pastille ronde et légère « − » / « + » du nombre de rangs récompensés. */
function StepButton({
  symbol,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  symbol: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const m = useLobbyMetrics();
  const size = Math.max(32, Math.round(m.controlHeight * 0.75));
  return (
    <Pressable
      onPress={() => {
        onPress();
        playSound('uiClick');
      }}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.step,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.stepPressed,
        disabled && styles.stepDisabled,
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[styles.stepSymbol, { fontSize: Math.round(size * 0.55) }]}
      >
        {symbol}
      </Text>
    </Pressable>
  );
}

/** Ton du statut RÉEL d'une proposition (présentation seule), mêmes couleurs que les badges. */
const toneOf = (tone: SalonTone) => ({
  color: salon.status[tone].text,
  borderColor: salon.status[tone].border,
  backgroundColor: salon.status[tone].fill,
});
const TONES: Record<ProposalTone, ReturnType<typeof toneOf>> = {
  neutral: toneOf('neutral'),
  pending: toneOf('attention'),
  success: toneOf('positive'),
  danger: toneOf('critical'),
};

const styles = StyleSheet.create({
  tabs: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  top: { alignItems: 'flex-start' },
  inline: { flexDirection: 'row', alignItems: 'center' },
  actions: { justifyContent: 'flex-end', flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 0, gap: 2 },
  share: { flexShrink: 0 },
  shareInput: { width: 52, paddingHorizontal: 6, textAlign: 'center' },
  // Rangs récompensés : encart doux, sans cadre de laiton.
  ranks: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: salon.surface.wellBorder,
    backgroundColor: salon.surface.well,
  },
  step: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(246, 239, 223, 0.18)',
    backgroundColor: 'rgba(246, 239, 223, 0.08)',
  },
  stepPressed: { backgroundColor: 'rgba(246, 239, 223, 0.18)', transform: [{ scale: 0.94 }] },
  stepDisabled: { opacity: 0.35 },
  stepSymbol: { color: salon.text, fontWeight: '600', includeFontPadding: false },
  totalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  shareChip: {
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(246, 239, 223, 0.12)',
    backgroundColor: 'rgba(246, 239, 223, 0.05)',
  },
  label: { color: salon.textSoft },
  hint: { color: salon.textFaint },
  name: { color: salon.text, flexShrink: 1 },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: gameTheme.brass.hairline,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 0,
    color: salon.text,
    fontWeight: '600',
  },
  inputInvalid: { borderColor: tablePalette.error },
  pickerText: { color: salon.text, fontWeight: '600' },
  error: { color: tablePalette.error },
});
