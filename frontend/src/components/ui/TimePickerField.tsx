import { useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  DATE_TIME_LOCALES,
  formatDisplayTime,
  formatFormTime,
  from12Hour,
  parseFormTime,
  to12Hour,
  type ClockTime,
  type Period,
} from '../../lib/date-time';
import { useLanguage, useMessages } from '../../lib/i18n';
import { AnchoredPopover, type Rect } from './AnchoredPopover';
import { PickerAction, pickerColors, PickerModal, PickerTrigger } from './PickerModal';

const ITEM_HEIGHT = 36;
const pad = (n: number) => String(n).padStart(2, '0');
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const HOURS_12 = [12, ...Array.from({ length: 11 }, (_, i) => i + 1)];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS: Period[] = ['AM', 'PM'];

/**
 * Champ Heure : colonnes Heures, Minutes et, en anglais, AM/PM. Le français affiche 24 h
 * (`20:00`), l'anglais 12 h (`08:00 PM`) ; la valeur transmise reste toujours `HH:MM` sur
 * 24 h. Le choix n'est appliqué qu'à la validation.
 * `presentation` : `modal` (fenêtre seule à l'écran, D-126) ou `popover` (horloge accrochée
 * au champ, l'écran courant reste visible, D-164).
 */
export function TimePickerField({
  label,
  value,
  onChange,
  invalid,
  placeholder,
  style,
  textStyle,
  testID,
  presentation = 'modal',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  presentation?: 'modal' | 'popover';
}) {
  const t = useMessages().pickers;
  const { clock } = DATE_TIME_LOCALES[useLanguage()];
  const current = parseFormTime(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ClockTime>(current ?? { hours: 0, minutes: 0 });
  const [anchor, setAnchor] = useState<Rect>();
  const trigger = useRef<View>(null);
  const popover = presentation === 'popover';
  // Paysage : 3 à 5 lignes visibles selon la hauteur de l'écran (titre, aperçu, actions).
  // Accrochée, l'horloge pose aperçu et actions à côté des colonnes : seules ces dernières
  // comptent en hauteur.
  const rows = Math.max(
    3,
    Math.min(5, Math.floor((useWindowDimensions().height - (popover ? 110 : 190)) / ITEM_HEIGHT)),
  );

  const show = () => {
    setDraft(current ?? { hours: 0, minutes: 0 });
    if (popover) {
      Keyboard.dismiss();
      trigger.current?.measureInWindow((x, y, width, height) =>
        setAnchor({ x, y, width, height }),
      );
    }
    setOpen(true);
  };
  const confirm = () => {
    onChange(formatFormTime(draft));
    setOpen(false);
  };
  const { hour, period } = to12Hour(draft.hours);

  const preview = (
    <Text accessibilityLiveRegion="polite" style={styles.preview} testID="time-picker-preview">
      {formatDisplayTime(draft, clock)}
    </Text>
  );
  const columns = (
    <View style={styles.columns}>
      {clock === '24h' ? (
        <Column
          title={t.hours}
          rows={rows}
          items={HOURS_24}
          selected={draft.hours}
          format={pad}
          onSelect={(hours) => setDraft((d) => ({ ...d, hours }))}
        />
      ) : (
        <Column
          title={t.hours}
          rows={rows}
          items={HOURS_12}
          selected={hour}
          format={pad}
          onSelect={(h) => setDraft((d) => ({ ...d, hours: from12Hour(h, period) }))}
        />
      )}
      <Column
        title={t.minutes}
        rows={rows}
        items={MINUTES}
        selected={draft.minutes}
        format={pad}
        onSelect={(minutes) => setDraft((d) => ({ ...d, minutes }))}
      />
      {clock === '12h' ? (
        <Column
          title={t.period}
          rows={rows}
          items={PERIODS}
          selected={period}
          format={String}
          onSelect={(p) => setDraft((d) => ({ ...d, hours: from12Hour(hour, p) }))}
        />
      ) : null}
    </View>
  );
  const actions = (
    <>
      <PickerAction title={t.cancel} onPress={() => setOpen(false)} />
      <PickerAction title={t.confirm} onPress={confirm} primary />
    </>
  );

  return (
    <>
      <PickerTrigger
        testID={testID}
        label={label}
        hint={t.chooseTime}
        display={current ? formatDisplayTime(current, clock) : undefined}
        placeholder={placeholder}
        icon="🕐"
        onPress={show}
        active={popover && open}
        ref={trigger}
        invalid={invalid}
        style={style}
        textStyle={textStyle}
      />
      {popover ? (
        <AnchoredPopover
          visible={open}
          anchor={anchor}
          label={label}
          closeLabel={t.close}
          onClose={() => setOpen(false)}
          testID="time-picker-popover"
        >
          {/* Colonnes à gauche ; aperçu et actions empilés à droite (paysage, écran bas). */}
          <View style={styles.compact}>
            {columns}
            <View style={styles.side}>
              {preview}
              <View style={styles.sideActions}>{actions}</View>
            </View>
          </View>
        </AnchoredPopover>
      ) : (
        <PickerModal
          visible={open}
          title={label}
          onClose={() => setOpen(false)}
          actions={actions}
        >
          {preview}
          {columns}
        </PickerModal>
      )}
    </>
  );
}

/** Colonne défilante ; la valeur choisie est centrée à l'ouverture. */
function Column<T extends string | number>({
  title,
  rows,
  items,
  selected,
  format,
  onSelect,
}: {
  title: string;
  rows: number;
  items: T[];
  selected: T;
  format: (item: T) => string;
  onSelect: (item: T) => void;
}) {
  const index = Math.max(0, items.indexOf(selected));
  const offset = Math.max(0, (index - Math.floor(rows / 2)) * ITEM_HEIGHT);
  return (
    <View style={styles.column} accessibilityRole="list" accessibilityLabel={title}>
      <Text style={styles.columnTitle}>{title}</Text>
      <ScrollView
        style={{ height: ITEM_HEIGHT * Math.min(rows, items.length) }}
        contentOffset={{ x: 0, y: offset }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {items.map((item) => {
          const isSelected = item === selected;
          return (
            <Pressable
              key={String(item)}
              accessibilityRole="button"
              accessibilityLabel={`${title} ${format(item)}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(item)}
              style={({ pressed }) => [
                styles.item,
                isSelected && styles.itemSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>
                {format(item)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    color: pickerColors.selected,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  columns: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  compact: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  side: { justifyContent: 'space-between', gap: 10, minWidth: 104 },
  sideActions: { gap: 6 },
  column: {
    width: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: pickerColors.line,
    overflow: 'hidden',
  },
  columnTitle: {
    color: pickerColors.muted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: pickerColors.line,
  },
  // Valeur choisie : pastille arrondie, en retrait des bords de la colonne.
  item: {
    height: ITEM_HEIGHT,
    marginHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemSelected: { backgroundColor: pickerColors.selected },
  itemText: { color: pickerColors.text, fontSize: 16, fontWeight: '600' },
  itemTextSelected: { color: pickerColors.selectedText },
  pressed: { opacity: 0.7 },
});
