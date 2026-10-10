/**
 * Heures du sélecteur « Heure de début ». La valeur transmise reste `HH:mm` sur 24 h (contrat
 * du formulaire et de l'API) ; seul l'affichage suit la locale : 24 h en français (`20:00`),
 * 12 h avec AM/PM pour une locale anglaise qui l'utilise (`08:00 PM` en en-US).
 */
export type Period = 'AM' | 'PM';

export interface ClockTime {
  /** 0 à 23. */
  hours: number;
  minutes: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function parseTime(value: string | undefined): ClockTime | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return undefined;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  return hours > 23 || minutes > 59 ? undefined : { hours, minutes };
}

export function toTimeValue({ hours, minutes }: ClockTime): string {
  return `${pad(hours)}:${pad(minutes)}`;
}

/** La locale affiche-t-elle les heures sur 12 h ? (fr-FR : non, en-US : oui). */
export function uses12Hour(locale: string): boolean {
  try {
    const { hourCycle, hour12 } = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
    }).resolvedOptions();
    return hourCycle ? hourCycle === 'h11' || hourCycle === 'h12' : Boolean(hour12);
  } catch {
    return false;
  }
}

export function to12Hour(hours: number): { hour: number; period: Period } {
  return { hour: hours % 12 === 0 ? 12 : hours % 12, period: hours < 12 ? 'AM' : 'PM' };
}

/** 12 AM = 0 h, 12 PM = 12 h. */
export function from12Hour(hour: number, period: Period): number {
  return (hour % 12) + (period === 'PM' ? 12 : 0);
}

export function formatTime(time: ClockTime, locale: string): string {
  if (!uses12Hour(locale)) return toTimeValue(time);
  const { hour, period } = to12Hour(time.hours);
  return `${pad(hour)}:${pad(time.minutes)} ${period}`;
}
