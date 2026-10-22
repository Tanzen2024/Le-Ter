import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  addMonths,
  compareDates,
  DATE_TIME_LOCALES,
  daysInMonth,
  formatDisplayDate,
  formatFormDate,
  formatLongDate,
  formatMonthTitle,
  monthGrid,
  parseFormDate,
  todayOf,
  weekdayLabels,
  type CalendarDate,
} from '../../lib/date-time';
import { useLanguage, useMessages } from '../../lib/i18n';
import { PickerAction, pickerColors, PickerModal, PickerTrigger } from './PickerModal';

type Month = { year: number; month: number };

/**
 * Champ Date avec calendrier (jour, mois, année). La valeur reste `JJ/MM/AAAA` quelle que
 * soit la langue ; l'affichage, les noms des mois et des jours suivent la langue de l'app.
 * `minDate` / `maxDate` : jours hors bornes grisés et non sélectionnables.
 */
export function DatePickerField({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  invalid,
  placeholder,
  style,
  textStyle,
  testID,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minDate?: CalendarDate;
  maxDate?: CalendarDate;
  invalid?: boolean;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const t = useMessages().pickers;
  const { locale, firstWeekday } = DATE_TIME_LOCALES[useLanguage()];
  const selected = parseFormDate(value);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Month>(() => selected ?? minDate ?? todayOf());
  const { height } = useWindowDimensions();
  // Paysage : en-tête + 6 semaines (7 rangées) doivent tenir avec le titre, les jours et les
  // actions (~150 dp en tout) ; au-delà, la fenêtre défile (jamais une rangée coupée).
  const cell = Math.max(28, Math.min(40, Math.floor((height - 150) / 7)));
  // Flèches plus étroites qu'un jour : le mois et l'année tiennent sur UNE ligne entre elles.
  const navWidth = Math.round(cell * 0.8);

  const show = () => {
    setShown(selected ?? minDate ?? todayOf());
    setOpen(true);
  };
  const outOfRange = (date: CalendarDate) =>
    (minDate !== undefined && compareDates(date, minDate) < 0) ||
    (maxDate !== undefined && compareDates(date, maxDate) > 0);
  // Un mois est accessible s'il contient au moins un jour dans les bornes.
  const canShow = (m: Month) =>
    (minDate === undefined ||
      compareDates({ ...m, day: daysInMonth(m.year, m.month) }, minDate) >= 0) &&
    (maxDate === undefined || compareDates({ ...m, day: 1 }, maxDate) <= 0);
  const go = (delta: number) => {
    const next = addMonths(shown, delta);
    if (canShow(next)) setShown(next);
  };
  const pick = (date: CalendarDate) => {
    onChange(formatFormDate(date));
    setOpen(false);
  };
  const today = todayOf();

  const nav = (glyph: string, a11y: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !canShow(addMonths(shown, delta)) }}
      disabled={!canShow(addMonths(shown, delta))}
      onPress={() => go(delta)}
      hitSlop={4}
      style={({ pressed }) => [
        styles.nav,
        { width: navWidth, height: cell },
        !canShow(addMonths(shown, delta)) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.navGlyph}>{glyph}</Text>
    </Pressable>
  );

  return (
    <>
      <PickerTrigger
        testID={testID}
        label={label}
        hint={t.chooseDate}
        display={selected ? formatDisplayDate(selected, locale) : undefined}
        placeholder={placeholder}
        icon="📅"
        onPress={show}
        invalid={invalid}
        style={style}
        textStyle={textStyle}
      />
      <PickerModal
        visible={open}
        title={label}
        onClose={() => setOpen(false)}
        scroll
        actions={<PickerAction title={t.cancel} onPress={() => setOpen(false)} />}
      >
        {/* Une seule colonne de 7 jours, sans espace entre les rangées : rien ne déborde. */}
        <View style={{ width: cell * 7 }}>
          <View style={styles.header}>
            {nav('«', t.previousYear, -12)}
            {nav('‹', t.previousMonth, -1)}
            <Text
              accessibilityLiveRegion="polite"
              // Toujours sur une ligne : sur un petit écran, le texte rétrécit au lieu d'être coupé.
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={styles.month}
              testID="date-picker-month"
            >
              {formatMonthTitle(shown.year, shown.month, locale)}
            </Text>
            {nav('›', t.nextMonth, 1)}
            {nav('»', t.nextYear, 12)}
          </View>
          <View style={styles.week}>
            {weekdayLabels(locale, firstWeekday).map((day, i) => (
              <Text
                key={i}
                style={[styles.weekday, { width: cell }]}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {day}
              </Text>
            ))}
          </View>
          {monthGrid(shown.year, shown.month, firstWeekday).map((week, w) => (
            <View key={w} style={styles.week}>
              {week.map((day, i) => {
                if (day === null) return <View key={i} style={{ width: cell, height: cell }} />;
                const date = { ...shown, day };
                const disabled = outOfRange(date);
                const isSelected = selected !== undefined && compareDates(date, selected) === 0;
                const isToday = compareDates(date, today) === 0;
                const long = formatLongDate(date, locale);
                return (
                  <Pressable
                    key={i}
                    accessibilityRole="button"
                    accessibilityLabel={disabled ? t.unavailableDay(long) : long}
                    accessibilityState={{ disabled, selected: isSelected }}
                    disabled={disabled}
                    onPress={() => pick(date)}
                    style={({ pressed }) => [
                      styles.day,
                      { width: cell, height: cell, borderRadius: cell / 2 },
                      isToday && styles.today,
                      isSelected && styles.selected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        disabled && styles.dayDisabled,
                        isSelected && styles.selectedText,
                      ]}
                    >
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </PickerModal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nav: { alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  navGlyph: { color: pickerColors.selected, fontSize: 20, fontWeight: '700' },
  month: {
    flex: 1,
    minWidth: 0,
    color: pickerColors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  week: { flexDirection: 'row', justifyContent: 'center' },
  weekday: {
    color: pickerColors.muted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  day: { alignItems: 'center', justifyContent: 'center' },
  dayText: { color: pickerColors.text, fontSize: 14, fontWeight: '600' },
  dayDisabled: {
    color: pickerColors.muted,
    textDecorationLine: 'line-through',
  },
  today: { borderWidth: 1, borderColor: pickerColors.today },
  selected: { backgroundColor: pickerColors.selected },
  selectedText: { color: pickerColors.selectedText },
  disabled: { opacity: 0.3 },
  pressed: { opacity: 0.7 },
});
