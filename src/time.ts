const TIME_UNITS =
  /^([a-zA-Z0-9._-]+)\s+since\s+(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?)/i;

export interface ParsedTimeUnits {
  unit: string;
  epochMs: number;
  scale: number;
}

export function parseTimeUnits(units: string): ParsedTimeUnits | null {
  const match = TIME_UNITS.exec(units.trim());
  if (!match) return null;
  const unit = match[1].toLowerCase();
  const epochText = match[2].replace(" ", "T");
  const epochMs = Date.parse(epochText.includes("T") ? `${epochText}Z` : `${epochText}T00:00:00Z`);
  if (!Number.isFinite(epochMs)) return null;

  const scale =
    unit === "second" || unit === "seconds" || unit === "s"
      ? 1000
      : unit === "millisecond" || unit === "milliseconds" || unit === "ms"
        ? 1
        : unit === "minute" || unit === "minutes"
          ? 60_000
          : unit === "hour" || unit === "hours"
            ? 3_600_000
            : unit === "day" || unit === "days"
              ? 86_400_000
              : 1000;

  return { unit, epochMs, scale };
}

export function timeValuesToDates(values: unknown[], units: string): Date[] {
  const parsed = parseTimeUnits(units);
  if (!parsed) {
    return values.map((_, index) => new Date(index));
  }
  return values.map((value) => {
    const numeric = typeof value === "bigint" ? Number(value) : Number(value);
    return new Date(parsed.epochMs + numeric * parsed.scale);
  });
}

export function parseIsoDurationMs(text: string): number | null {
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(text);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseTimeOfDay(text: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

export function timeOfDayMs(date: Date): number {
  return (
    date.getUTCHours() * 3_600_000 +
    date.getUTCMinutes() * 60_000 +
    date.getUTCSeconds() * 1000 +
    date.getUTCMilliseconds()
  );
}

export interface TimeIndexFilter {
  selectedDate: string;
  startMs: number;
  endMs: number;
}

export function filterTimeIndices(dates: Date[], filter: TimeIndexFilter): number[] {
  const day = new Date(`${filter.selectedDate}T00:00:00Z`);
  const indices: number[] = [];
  for (let index = 0; index < dates.length; index++) {
    const date = dates[index];
    if (!sameCalendarDay(date, day)) continue;
    const tod = timeOfDayMs(date);
    if (tod >= filter.startMs && tod <= filter.endMs) {
      indices.push(index);
    }
  }
  return indices;
}

export function defaultDayFromDates(dates: Date[]): string {
  if (dates.length === 0) return formatDate(new Date());
  return formatDate(dates[Math.floor(dates.length / 2)]);
}

export function dateRangeFromDates(dates: Date[]): { min: string; max: string } {
  if (dates.length === 0) {
    const today = formatDate(new Date());
    return { min: today, max: today };
  }
  return { min: formatDate(dates[0]), max: formatDate(dates.at(-1)!) };
}

export function filterTimeIndicesByDay(dates: Date[], selectedDate: string): number[] {
  const indices: number[] = [];
  for (let index = 0; index < dates.length; index++) {
    if (sameCalendarDay(dates[index], new Date(`${selectedDate}T00:00:00Z`))) {
      indices.push(index);
    }
  }
  return indices;
}
