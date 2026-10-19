import { router } from 'expo-router';
import { useRef, useState, type Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { ApiError, isAlreadyPlaying } from '../../lib/api-client';
import { useCurrentUser } from '../auth/hooks';
import { MAX_PLAYER_CHOICES, type MaxPlayers } from '../games/hooks';
import type { OpenTable } from '../../types/session';
import {
  useCreateSession,
  useDetectionAvailable,
  useMySessions,
  useOpenTables,
} from '../sessions/hooks';
import { useLobbyMetrics, type LobbyMetrics } from './lobby-metrics';
import { Coin, InnerFrame, LobbyPanel, PanelButton } from './LobbyUi';
import { SHIELD_LABELS, ShieldGlyph, ShieldIndicator } from './ShieldIndicator';
import { useEnterTable, type EnterTarget } from './use-enter-table';

/**
 * Partie privée : créer une partie, ou en rejoindre une. L'utilisateur ne voit que des
 * PARTIES : la session (D-033) qui les porte reste technique, et chaque action mène
 * directement à l'aire de jeu (jamais à un écran intermédiaire).
 *
 * Nom, mise, nombre de joueurs et mot de passe facultatif sont enregistrés par le serveur
 * (D-039). La mise reste indicative : aucun mouvement de jetons n'existe encore (R-13).
 */
export function PrivateGamePanel({ onClose }: { onClose: () => void }) {
  const m = useLobbyMetrics();
  const { data: user } = useCurrentUser();
  const table = useEnterTable(user?.id, onClose);
  return (
    <LobbyPanel title="Partie privée" onClose={onClose} width={Math.max(520, m.width * 0.7)}>
      <View style={[styles.columns, { gap: m.gap }]}>
        <CreateColumn onClose={onClose} enter={table.enter} />
        <SearchColumn table={table} />
      </View>
    </LobbyPanel>
  );
}

/** Mêmes limites que le serveur (validators/game.validators.ts) : retour immédiat. */
const NAME_MAX_LENGTH = 40;
const PASSWORD_MIN_LENGTH = 4;

function CreateColumn({
  onClose,
  enter,
}: {
  onClose: () => void;
  enter: (target: EnterTarget) => void;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const { data: user } = useCurrentUser();
  const mine = useMySessions();
  const create = useCreateSession();
  // `undefined` : le joueur n'a pas encore touché au nom → « Partie de <pseudo> ».
  const [name, setName] = useState<string>();
  const [stake, setStake] = useState('');
  const [password, setPassword] = useState('');
  const [maxPlayers, setMaxPlayers] = useState<MaxPlayers>(4);
  // Détection anti-collusion (D-043) : désactivée par défaut ; fixée à la création. Proposée
  // seulement si l'administration l'a activée globalement (D-053, D-081).
  const detectionAvailable = useDetectionAvailable();
  const [detection, setDetection] = useState(false);
  const [formError, setFormError] = useState<string>();
  const defaultName = user ? `Partie de ${user.username}` : '';
  const shownName = name ?? defaultName;
  const failure =
    formError ?? (create.error instanceof ApiError ? create.error.message : undefined);
  // Une seule partie à la fois par joueur (R-18, D-034) : c'est un refus du SERVEUR, jamais
  // un blocage préalable du formulaire. Le joueur est alors renvoyé automatiquement à sa
  // table (relue sur le serveur), sans bouton « Reprendre ma partie ».
  const returnToMyTable = async () => {
    const myTable = (await mine.refetch()).data?.[0];
    if (myTable) enter({ kind: 'resume', sessionId: myTable.sessionId });
  };

  const label = [styles.label, fontOf(fonts.button), { fontSize: m.bodySize }];
  const nextCapacity = () =>
    setMaxPlayers(
      (n) => MAX_PLAYER_CHOICES[(MAX_PLAYER_CHOICES.indexOf(n) + 1) % MAX_PLAYER_CHOICES.length],
    );

  const submit = () => {
    const trimmed = shownName.trim();
    const stakeAmount = stake.trim() === '' ? 0 : Number(stake);
    if (trimmed.length < 1 || trimmed.length > NAME_MAX_LENGTH) {
      setFormError(`Le nom doit contenir de 1 à ${NAME_MAX_LENGTH} caractères.`);
      return;
    }
    if (!Number.isSafeInteger(stakeAmount) || stakeAmount < 0) {
      setFormError('La mise doit être un nombre entier positif ou nul.');
      return;
    }
    if (password !== '' && password.length < PASSWORD_MIN_LENGTH) {
      setFormError(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
      return;
    }
    setFormError(undefined);
    create.create(
      {
        maxPlayers,
        name: trimmed,
        stakeAmount,
        suspicionDetectionEnabled: detectionAvailable && detection,
        ...(password !== '' && { password }),
      },
      {
        // Arrivée DIRECTE dans l'aire de jeu : le créateur est déjà joueur de la partie.
        onSuccess: ({ game }) => {
          onClose();
          router.push(`/game/${game.gameId}`);
        },
        onError: (err) => {
          if (isAlreadyPlaying(err)) void returnToMyTable();
        },
      },
    );
  };
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setFormError(undefined);
    };

  return (
    <InnerFrame style={[styles.column, { gap: m.gap * 0.7 }]}>
      <ColumnTitle>Créer une partie</ColumnTitle>
      <View style={[styles.row, { gap: m.gap }]}>
        <Text style={label}>Nom :</Text>
        <PanelInput
          value={shownName}
          onChangeText={edit(setName)}
          maxLength={NAME_MAX_LENGTH}
          placeholder="Nom de la partie"
          accessibilityLabel="Nom de la partie"
          returnKeyType="next"
        />
      </View>
      <View style={[styles.row, { gap: m.gap }]}>
        <Text style={label}>Mise :</Text>
        <View style={[styles.flex, styles.row]}>
          <PanelInput
            value={stake}
            onChangeText={edit((v: string) => setStake(v.replace(/[^0-9]/g, '')))}
            placeholder="0"
            keyboardType="number-pad"
            maxLength={9}
            textAlign="center"
            accessibilityLabel="Mise en jetons"
          />
          <View style={[styles.coinInField, { right: -m.controlHeight * 0.15 }]}>
            <Coin size={Math.round(m.controlHeight * 1.05)} fontFamily={fonts.title} />
          </View>
        </View>
      </View>
      <View style={[styles.row, styles.between, { gap: m.gap }]}>
        <Text style={label}>Nombre de joueurs :</Text>
        <Pressable
          onPress={nextCapacity}
          accessibilityRole="adjustable"
          accessibilityLabel={`Nombre de joueurs : ${maxPlayers}`}
          accessibilityHint="Touchez pour changer (2, 3 ou 4)"
          hitSlop={8}
          style={({ pressed }) => [
            styles.field,
            styles.capacity,
            { height: m.controlHeight * 0.85, minWidth: m.controlHeight * 1.6 },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.capacityText, fontOf(fonts.button), { fontSize: m.bodySize * 1.2 }]}>
            {maxPlayers}
          </Text>
        </Pressable>
      </View>
      <View style={[styles.row, { gap: m.gap }]}>
        <Text style={label}>Mot de passe :</Text>
        <PanelInput
          value={password}
          onChangeText={edit(setPassword)}
          placeholder="Optionnel"
          secureTextEntry
          autoCapitalize="none"
          textContentType="none"
          autoComplete="off"
          accessibilityLabel="Mot de passe de la partie, facultatif"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </View>
      {detectionAvailable ? (
        <Pressable
          onPress={() => setDetection((v) => !v)}
          accessibilityRole="switch"
          accessibilityLabel="Détection anti-collusion"
          accessibilityState={{ checked: detection }}
          accessibilityHint={detection ? SHIELD_LABELS.on : SHIELD_LABELS.off}
          hitSlop={6}
          style={({ pressed }) => [styles.row, { gap: m.gap * 0.6 }, pressed && styles.pressed]}
        >
          <ShieldGlyph enabled={detection} size={Math.round(m.bodySize * 1.15)} />
          <Text style={[label, !detection && styles.dimmed]}>Détection anti-collusion</Text>
        </Pressable>
      ) : null}
      {failure ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {failure}
        </Text>
      ) : null}
      <View style={[styles.row, styles.centeredRow, { gap: m.gap }]}>
        <PanelButton title="Créer" loading={create.isPending} onPress={submit} />
      </View>
    </InnerFrame>
  );
}

/** Partie créée par le formulaire « Créer une partie » (D-039) : elle porte toujours un nom. */
type PrivateGame = OpenTable & { name: string };

/**
 * Une ligne = une partie privée RÉELLEMENT créée, telle que le serveur la renvoie (en
 * attente, place libre). Les tables sans nom viennent de l'ancien écran « Nouvelle session »
 * (avant D-039) : ce ne sont pas des parties privées, on ne leur invente ni nom ni mise.
 */
const isPrivateGame = (t: OpenTable): t is PrivateGame => t.name !== undefined;

function SearchColumn({ table }: { table: ReturnType<typeof useEnterTable> }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const open = useOpenTables();
  // Détection coupée par l'administration (D-081) : aucune colonne « bouclier ».
  const detectionAvailable = useDetectionAvailable();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  // Partie 🔒 choisie : le mot de passe est demandé sous sa ligne.
  const [locked, setLocked] = useState<OpenTable>();
  const [secret, setSecret] = useState('');
  const [tableWidth, setTableWidth] = useState(0);
  // Actualisation demandée par le joueur : distincte de la relecture automatique (3 s),
  // qui ne doit pas faire clignoter le bouton.
  const [refreshing, setRefreshing] = useState(false);
  const columns = tableColumns(m, tableWidth);
  const needle = query.trim().toLowerCase();
  const tables = (open.data ?? [])
    .filter(isPrivateGame)
    .filter((t) => t.name.toLowerCase().includes(needle));
  const listFailure = open.error instanceof ApiError ? open.error.message : undefined;
  const failure = table.passwordRejected ? undefined : (table.message ?? listFailure);
  const pending = table.pendingTarget;
  const busyJoin = (sessionId: string) =>
    pending?.kind === 'join' && pending.table.sessionId === sessionId;
  const busyResume = pending?.kind === 'resume';

  const select = (t: OpenTable) => {
    if (t.mine) {
      table.enter({ kind: 'resume', sessionId: t.sessionId });
    } else if (t.hasPassword) {
      table.reset();
      setSecret('');
      setLocked((current) => (current?.sessionId === t.sessionId ? undefined : t));
    } else {
      table.enter({ kind: 'join', table: t });
    }
  };
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void open.refetch().finally(() => setRefreshing(false));
  };
  const joinLocked = () => {
    if (locked && secret !== '') table.enter({ kind: 'join', table: locked, password: secret });
  };

  return (
    <InnerFrame style={[styles.column, { gap: m.gap * 0.7 }]}>
      <ColumnTitle>Rechercher une partie</ColumnTitle>
      <View style={[styles.row, { gap: m.gap * 0.8 }]}>
        <View style={[styles.flex, styles.row]}>
          <PanelInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Nom de partie…"
            accessibilityLabel="Rechercher une partie par son nom"
            autoCapitalize="none"
            returnKeyType="search"
            style={{ paddingRight: m.controlHeight * 0.9 }}
          />
          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="search"
            accessibilityLabel="Rechercher"
            hitSlop={8}
            style={({ pressed }) => [
              styles.searchIcon,
              { width: m.controlHeight * 0.8, height: m.controlHeight * 0.8 },
              pressed && styles.pressed,
            ]}
          >
            <Magnifier size={m.controlHeight * 0.48} />
          </Pressable>
        </View>
        <SquareButton
          label="Actualiser la liste des parties"
          glyph="↻"
          busy={refreshing}
          onPress={refresh}
        />
      </View>
      {failure ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {failure}
        </Text>
      ) : null}
      <View onLayout={(e) => setTableWidth(Math.round(e.nativeEvent.layout.width))}>
        <TableHeader c={columns} shield={detectionAvailable} />
      </View>
      <View style={[styles.list, { minHeight: m.controlHeight * 2 }]}>
        {open.isPending ? <ActivityIndicator color={palette.gold} /> : null}
        {open.isSuccess && tables.length === 0 ? (
          <View style={[styles.emptyBox, { gap: m.gap * 0.5, padding: m.gap }]}>
            <View
              style={[
                styles.emptyIcon,
                {
                  width: m.controlHeight * 1.1,
                  height: m.controlHeight * 1.1,
                  borderRadius: m.controlHeight * 0.55,
                  marginBottom: m.gap * 0.2,
                },
              ]}
            >
              <Magnifier size={m.controlHeight * 0.5} />
            </View>
            <Text
              style={[
                styles.emptyTitle,
                // Graisse forcée seulement sur la police système (cf. fontOf).
                fonts.button ? { fontFamily: fonts.button } : { fontWeight: '600' },
                { fontSize: Math.round(m.smallSize * 1.15) },
              ]}
            >
              Aucune partie trouvée.
            </Text>
            <Text
              style={[
                styles.emptyHint,
                { fontSize: m.smallSize, lineHeight: Math.round(m.smallSize * 1.4) },
              ]}
            >
              Rafraîchissez la liste ou créez une nouvelle partie.
            </Text>
          </View>
        ) : null}
        {tables.map((t) => (
          <View key={t.sessionId} style={{ gap: m.gap * 0.5 }}>
            <GameRow
              c={columns}
              name={t.name}
              mine={t.mine}
              locked={t.hasPassword}
              guarded={detectionAvailable ? t.suspicionDetectionEnabled : undefined}
              stake={t.stakeAmount}
              players={`${t.playerCount}/${t.maxPlayers}`}
              label={t.mine ? `Retourner à ma table : ${t.name}` : `Rejoindre : ${t.name}`}
              busy={t.mine ? busyResume : busyJoin(t.sessionId)}
              onOpen={() => select(t)}
            />
            {locked?.sessionId === t.sessionId ? (
              <View style={[styles.row, { gap: m.gap * 0.6 }]}>
                <PanelInput
                  value={secret}
                  onChangeText={(v) => {
                    setSecret(v);
                    table.reset();
                  }}
                  placeholder="Mot de passe"
                  secureTextEntry
                  autoCapitalize="none"
                  autoFocus
                  accessibilityLabel={`Mot de passe de ${t.name}`}
                  returnKeyType="go"
                  onSubmitEditing={joinLocked}
                />
                <PanelButton
                  title="Rejoindre"
                  disabled={secret === ''}
                  loading={busyJoin(t.sessionId)}
                  onPress={joinLocked}
                />
              </View>
            ) : null}
            {locked?.sessionId === t.sessionId && table.passwordRejected ? (
              <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
                Mot de passe incorrect.
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </InnerFrame>
  );
}

/**
 * Colonnes du tableau, partagées par l'en-tête et les lignes (alignement garanti) :
 * [Cadenas] [Nom] [Mise] [Joueurs] [Rejoindre]. Cadenas et Rejoindre ont une largeur fixe ;
 * Nom / Mise / Joueurs se partagent le reste en 38 / 16 / 20, avec un minimum calculé sur la
 * police pour que « Joueurs », « 4/4 » et « 1000 + jeton » ne passent jamais à la ligne :
 * sur petit écran, c'est le Nom (ellipsis) qui cède.
 *
 * La police suit la largeur MESURÉE du tableau, pas la hauteur de l'écran : le panneau garde
 * sa largeur minimale sur les petits paysages alors que `smallSize` grandit avec la hauteur.
 */
function tableColumns(m: LobbyMetrics, width: number) {
  const font =
    width > 0 ? Math.min(m.smallSize, Math.max(11, Math.floor(width / 20))) : m.smallSize;
  const join = Math.max(30, Math.round(font * 2.4));
  return {
    font,
    join,
    coin: Math.round(font * 1.1),
    gap: 4,
    lock: { width: Math.round(font * 1.6) },
    shield: { width: Math.round(font * 1.6) },
    name: { flexGrow: 38, flexBasis: 0, minWidth: 0 },
    // Minimums mesurés dans la police des cellules (Rajdhani Bold) : « 12366 » + jeton ≈ 3,76 ×,
    // « Joueurs » ≈ 3,36 × la taille ; le reste va au Nom, lisible sur smartphone.
    stake: { flexGrow: 16, flexBasis: 0, minWidth: Math.round(font * 3.8) },
    players: { flexGrow: 20, flexBasis: 0, minWidth: Math.round(font * 3.4) },
    action: { width: join },
  };
}

type TableColumns = ReturnType<typeof tableColumns>;

function TableHeader({ c, shield }: { c: TableColumns; shield: boolean }) {
  const fonts = useTableFonts();
  const header = [styles.header, fontOf(fonts.button), { fontSize: c.font }];
  return (
    <View style={[styles.row, { gap: c.gap }]}>
      <View style={c.lock} />
      {shield ? <View style={c.shield} /> : null}
      <Text numberOfLines={1} style={[header, styles.left, c.name]}>
        Nom
      </Text>
      <Text numberOfLines={1} style={[header, c.stake]}>
        Mise
      </Text>
      <Text numberOfLines={1} style={[header, c.players]}>
        Joueurs
      </Text>
      <View style={c.action} />
    </View>
  );
}

function GameRow({
  c,
  name,
  mine,
  locked,
  guarded,
  stake,
  players,
  label,
  busy,
  onOpen,
}: {
  c: TableColumns;
  name: string;
  mine: boolean;
  locked: boolean;
  /**
   * Réglage « détection anti-collusion » de la partie, valeur du serveur (D-043). Absent :
   * détection coupée par l'administration, aucun bouclier affiché (D-081).
   */
  guarded?: boolean;
  /** Absente : aucune mise enregistrée (jamais remplacée par 0). */
  stake?: number;
  players: string;
  label: string;
  busy: boolean;
  onOpen: () => void;
}) {
  const fonts = useTableFonts();
  const cell = [styles.cell, fontOf(fonts.button), { fontSize: c.font }];
  return (
    <View style={[styles.row, { gap: c.gap }]}>
      <Text
        allowFontScaling={false}
        style={[styles.lockCell, { fontSize: c.font }, c.lock]}
        accessibilityLabel={locked ? 'Protégée par un mot de passe' : 'Sans mot de passe'}
      >
        {locked ? '🔒' : '🔓'}
      </Text>
      {guarded !== undefined ? (
        <View style={[styles.capacity, c.shield]}>
          <ShieldIndicator enabled={guarded} size={Math.round(c.font * 0.95)} fontSize={c.font} />
        </View>
      ) : null}
      <Text
        numberOfLines={2}
        ellipsizeMode="tail"
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={[cell, styles.left, c.name]}
      >
        {mine ? '⭐ ' : ''}
        {name}
      </Text>
      <View style={[styles.row, styles.stakeCell, c.stake]}>
        <Text numberOfLines={1} style={cell}>
          {stake ?? '—'}
        </Text>
        {stake !== undefined ? <Coin size={c.coin} /> : null}
      </View>
      <Text numberOfLines={1} style={[cell, styles.centered, c.players]}>
        {players}
      </Text>
      <View style={[styles.capacity, c.action]}>
        {busy ? (
          <ActivityIndicator color={palette.gold} />
        ) : (
          <SquareButton label={label} glyph="➜" size={c.join} onPress={onOpen} />
        )}
      </View>
    </View>
  );
}

function ColumnTitle({ children }: { children: string }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      adjustsFontSizeToFit
      style={[
        styles.columnTitle,
        fontOf(fonts.button),
        { fontSize: Math.round(m.panelTitleSize * 0.7) },
      ]}
    >
      {children}
    </Text>
  );
}

/** Champ gris arrondi de la maquette ; désactivé, il est estompé. */
function PanelInput({
  style,
  editable = true,
  ref,
  ...props
}: TextInputProps & { ref?: Ref<TextInput> }) {
  const m = useLobbyMetrics();
  return (
    <TextInput
      ref={ref}
      editable={editable}
      placeholderTextColor="rgba(235, 235, 235, 0.6)"
      autoCorrect={false}
      style={[
        styles.field,
        styles.input,
        { height: m.controlHeight * 0.85, fontSize: m.smallSize },
        !editable && styles.disabledField,
        style,
      ]}
      {...props}
    />
  );
}

function SquareButton({
  label,
  glyph,
  size: forcedSize,
  busy = false,
  onPress,
}: {
  label: string;
  glyph: string;
  /** Action en cours : indicateur à la place du glyphe, bouton inactif. */
  busy?: boolean;
  /** Côté visible ; la zone tactile est étendue à 44 dp au moins (Android). */
  size?: number;
  onPress: () => void;
}) {
  const m = useLobbyMetrics();
  const size = forcedSize ?? Math.max(36, Math.round(m.controlHeight * 0.85));
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      hitSlop={Math.max(6, Math.ceil((44 - size) / 2))}
      style={({ pressed }) => [
        styles.square,
        { width: size, height: size },
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#FFD84A" />
      ) : (
        <Text allowFontScaling={false} style={[styles.squareGlyph, { fontSize: size * 0.6 }]}>
          {glyph}
        </Text>
      )}
    </Pressable>
  );
}

/** Loupe dorée dessinée (cercle + manche). */
function Magnifier({ size }: { size: number }) {
  const stroke = Math.max(2, size * 0.16);
  const lens = size * 0.72;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.lens,
          { width: lens, height: lens, borderRadius: lens / 2, borderWidth: stroke },
        ]}
      />
      <View
        style={[
          styles.handle,
          {
            width: size * 0.42,
            height: stroke,
            borderRadius: stroke / 2,
            right: -size * 0.04,
            bottom: size * 0.12,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'stretch' },
  column: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  flex: { flex: 1, minWidth: 0 },
  centeredRow: { justifyContent: 'center', flexWrap: 'wrap' },
  pressed: { opacity: 0.75 },
  columnTitle: { color: '#FFFFFF', textAlign: 'center' },
  label: { color: '#FFFFFF' },
  field: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: '#555555',
    experimental_backgroundImage: 'linear-gradient(180deg, #666666 0%, #4A4A4A 100%)',
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 0,
    color: '#FFFFFF',
    fontStyle: 'italic',
    fontWeight: '600',
  },
  disabledField: { opacity: 0.6 },
  coinInField: { position: 'absolute' },
  capacity: { alignItems: 'center', justifyContent: 'center' },
  capacityText: { color: '#FFFFFF' },
  searchIcon: { position: 'absolute', right: 4, alignItems: 'center', justifyContent: 'center' },
  lens: { borderColor: palette.gold },
  handle: {
    position: 'absolute',
    backgroundColor: palette.gold,
    transform: [{ rotate: '45deg' }],
  },
  square: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.4)',
    backgroundColor: palette.jade,
    experimental_backgroundImage: 'linear-gradient(180deg, #2FB27A 0%, #1E9064 60%, #157150 100%)',
  },
  squareGlyph: { color: '#FFD84A', fontWeight: '900', includeFontPadding: false },
  header: { color: '#FFFFFF', textAlign: 'center' },
  left: { textAlign: 'left' },
  centered: { textAlign: 'center' },
  stakeCell: { justifyContent: 'center', gap: 3 },
  lockCell: { textAlign: 'center' },
  dimmed: { opacity: 0.6 },
  cell: { color: '#FFFFFF' },
  list: {
    flexGrow: 1,
    gap: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: palette.panelBorder,
  },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 81, 0.25)',
    backgroundColor: 'rgba(23, 128, 110, 0.22)',
  },
  emptyTitle: { color: palette.cream, textAlign: 'center' },
  emptyHint: {
    maxWidth: 320,
    color: 'rgba(247, 241, 225, 0.68)',
    textAlign: 'center',
    fontWeight: '400',
  },
  error: { color: palette.error, textAlign: 'center', fontWeight: '600' },
});
