export type DayReminderStage = 'reminder' | 'soon' | 'now' | null;

export interface DayReminderSchedule {
  eventTime: string | null;
  reminderTime?: string | null;
  notifyMinutes?: number | null;
}

function minutesOnDate(now: Date, hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return (target.getTime() - now.getTime()) / 60_000;
}

/**
 * Calculate the single notification stage due in the current two-minute poll
 * window. An explicit wall-clock reminder replaces the relative "soon" alert;
 * the event's "now" alert remains independent and can still fire at event time.
 */
export function getDayReminderStage(schedule: DayReminderSchedule, now: Date): DayReminderStage {
  if (schedule.reminderTime) {
    const reminderMinutes = minutesOnDate(now, schedule.reminderTime);
    if (reminderMinutes !== null && reminderMinutes <= 0 && reminderMinutes > -2) return 'reminder';
  }

  const eventMinutes = schedule.eventTime ? minutesOnDate(now, schedule.eventTime) : null;
  if (eventMinutes === null) return null;
  if (eventMinutes <= 0 && eventMinutes > -2) return 'now';

  // Explicit reminder time suppresses the competing relative lead-time alert.
  if (schedule.reminderTime) return null;
  const leadMinutes = Math.max(0, schedule.notifyMinutes ?? 10);
  return eventMinutes > 0 && eventMinutes <= leadMinutes ? 'soon' : null;
}

export function parseNonNegativeInteger(value: string, fallback: number): number {
  if (!/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}
