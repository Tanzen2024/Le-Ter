import type { Language } from '../stores/preferences-store';

/**
 * Dates et heures des sélecteurs (calendrier, heure). La valeur INTERNE ne dépend jamais de
 * la langue : date `JJ/MM/AAAA` et heure `HH:MM` (24 h), lues comme heure locale du
 * téléphone. Seul l'AFFICHAGE est localisé.
 *
 * Aucune chaîne ISO « AAAA-MM-JJ » n'est analysée par `Date` (elle serait lue en UTC et
 * pourrait décaler le jour) : tout passe par des composantes numériques locales.
 */
export interface CalendarDate {
  year: number;
  /** 1 à 12. */
  month: number;
  day: number;
}

export interface ClockTime {
  /** 0 à 23. */
  hours: number;
  minutes: number;
}

export type ClockFormat = '24h' | '12h';
export type Period = 'AM' | 'PM';

/**
 * Conventions d'affichage par langue. Français : 24 h, semaine commençant le lundi.
 * Anglais : variante britannique configurée dans l'app (`en-GB`, jour en premier, lundi),
 * avec l'heure sur 12 h (AM/PM).
 */
export const DATE_TIME_LOCALES: Record<
  Language,
  { locale: string; clock: ClockFormat; firstWeekday: 0 | 1 }
> = {
  fr: { locale: 'fr-FR', clock: '24h', firstWeekday: 1 },
  en: { locale: 'en-GB', clock: '12h', firstWeekday: 1 },
};

const pad = (n: number) => String(n).padStart(2, '0');

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** `JJ/MM/AAAA` → composantes, `undefined` si le format ou la date est invalide (31/02). */
export function parseFormDate(value: string): CalendarDate | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return undefined;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

export function formatFormDate({ year, month, day }: CalendarDate): string {
  return `${pad(day)}/${pad(month)}/${year}`;
}

/** `HH:MM` (24 h) → composantes. */
export function parseFormTime(value: string): ClockTime | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  if (hours > 23 || minutes > 59) return undefined;
  return { hours, minutes };
}

export function formatFormTime({ hours, minutes }: ClockTime): string {
  return `${pad(hours)}:${pad(minutes)}`;
}

export function todayOf(now: Date = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** Négatif si `a` est avant `b`, 0 si même jour. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Mois voisin (`delta` mois plus tard, négatif pour reculer), années comprises. */
export function addMonths(
  { year, month }: Pick<CalendarDate, 'year' | 'month'>,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Midi local : aucun changement d'heure ni fuseau ne peut faire changer le jour. */
const noon = ({ year, month, day }: CalendarDate) => new Date(year, month - 1, day, 12);

/** Date localisée : `10/10/2026` (fr-FR, en-GB). */
export function formatDisplayDate(date: CalendarDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(noon(date));
}

/** Date longue pour les lecteurs d'écran : « samedi 10 octobre 2026 ». */
export function formatLongDate(date: CalendarDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(noon(date));
}

/** Titre du calendrier : « octobre 2026 » / « October 2026 ». */
export function formatMonthTitle(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    noon({ year, month, day: 1 }),
  );
}

/** Initiales courtes des jours de la semaine, dans l'ordre affiché. */
export function weekdayLabels(locale: string, firstWeekday: 0 | 1): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 4 janvier 2026 : un dimanche.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(2026, 0, 4 + ((i + firstWeekday) % 7), 12)),
  );
}

/** Semaines du mois : `null` pour les cases hors du mois. */
export function monthGrid(year: number, month: number, firstWeekday: 0 | 1): (number | null)[][] {
  const offset = (new Date(year, month - 1, 1).getDay() - firstWeekday + 7) % 7;
  const cells: (number | null)[] = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** 0–23 → heure sur 12 h (12, 1…11) et période. */
export function to12Hour(hours: number): { hour: number; period: Period } {
  return { hour: hours % 12 === 0 ? 12 : hours % 12, period: hours < 12 ? 'AM' : 'PM' };
}

/** Heure sur 12 h et période → 0–23 (12 AM = 0, 12 PM = 12). */
export function from12Hour(hour: number, period: Period): number {
  return (hour % 12) + (period === 'PM' ? 12 : 0);
}

/** Heure affichée : `20:00` (24 h) ou `08:00 PM` (12 h). */
export function formatDisplayTime(time: ClockTime, clock: ClockFormat): string {
  if (clock === '24h') return formatFormTime(time);
  const { hour, period } = to12Hour(time.hours);
  return `${pad(hour)}:${pad(time.minutes)} ${period}`;
}
