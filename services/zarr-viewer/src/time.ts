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

export function formatTimeHourUtc(date: Date): string {
  return `${date.getUTCHours()}H UTC`;
}

export function formatTimeStepLabel(date: Date, stepMs: number | null): string {
  if (stepMs !== null && stepMs < 3_600_000) {
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm} UTC`;
  }
  return formatTimeHourUtc(date);
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftUtcDate(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
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
  return formatDate(dates[0]);
}

/** Default calendar day: last date on the axis (most recent timestep). */
export function defaultDayFromDatesLast(dates: Date[]): string {
  if (dates.length === 0) return formatDate(new Date());
  return formatDate(dates.at(-1)!);
}

/** Default time index within a day's indices (middle step, aligned with date-picker). */
export function defaultTimeIndexForDay(timeIndices: number[]): number {
  if (timeIndices.length === 0) {
    throw new Error("defaultTimeIndexForDay requires at least one index");
  }
  return timeIndices[Math.floor(timeIndices.length / 2)]!;
}

/** Default time index within a day: last step of that day. */
export function defaultTimeIndexForDayLast(timeIndices: number[]): number {
  if (timeIndices.length === 0) {
    throw new Error("defaultTimeIndexForDayLast requires at least one index");
  }
  return timeIndices.at(-1)!;
}

/** Default time index within a day: first step of that day. */
export function defaultTimeIndexForDayFirst(timeIndices: number[]): number {
  if (timeIndices.length === 0) {
    throw new Error("defaultTimeIndexForDayFirst requires at least one index");
  }
  return timeIndices[0]!;
}

/** Pick a timestep on the current day using axis cadence (metadata only). */
export function defaultTimeIndexForAxis(dates: Date[], timeIndices: number[]): number {
  if (timeIndices.length === 0) {
    throw new Error("defaultTimeIndexForAxis requires at least one index");
  }
  if (supportsIntraDayTimePlayback(dates)) {
    return defaultTimeIndexForDayFirst(timeIndices);
  }
  return timeIndices.at(-1)!;
}

/** Search order from middle of day outward (for finding a frame with valid data). */
export function timeIndicesSearchOrder(timeIndices: number[]): number[] {
  if (timeIndices.length === 0) return [];
  const mid = Math.floor(timeIndices.length / 2);
  const order: number[] = [timeIndices[mid]!];
  for (let offset = 1; offset < timeIndices.length; offset++) {
    const before = mid - offset;
    const after = mid + offset;
    if (before >= 0) order.push(timeIndices[before]!);
    if (after < timeIndices.length) order.push(timeIndices[after]!);
  }
  return order;
}

/** Search order from the end of the axis backward. */
export function timeIndicesGlobalBackwardOrder(length: number, limit?: number): number[] {
  const order: number[] = [];
  for (let index = length - 1; index >= 0; index--) {
    order.push(index);
    if (limit !== undefined && order.length >= limit) break;
  }
  return order;
}

/**
 * Probe order aligned on Zarr time chunks: chunk end, then chunk start, walking backward.
 * Finds the latest timestep with data using at most two loads per chunk.
 */
export function timeIndicesChunkProbeOrder(
  length: number,
  chunkSize: number,
  fromIndex = length - 1,
): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  const push = (index: number): void => {
    if (index < 0 || index >= length || seen.has(index)) return;
    seen.add(index);
    order.push(index);
  };

  const safeChunkSize = Math.max(1, chunkSize);
  const startChunk = Math.floor(fromIndex / safeChunkSize) * safeChunkSize;
  for (let chunkStart = startChunk; chunkStart >= 0; chunkStart -= safeChunkSize) {
    const chunkEnd = Math.min(chunkStart + safeChunkSize - 1, length - 1);
    push(chunkEnd);
    if (chunkEnd !== chunkStart) push(chunkStart);
  }
  return order;
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

const DAY_MS = 86_400_000;

/** Infer cadence from the first increasing pair on the time axis. */
export function inferTimeStepMs(dates: Date[]): number | null {
  for (let index = 1; index < dates.length; index++) {
    const diff = dates[index].getTime() - dates[index - 1]!.getTime();
    if (diff > 0) return diff;
  }
  return null;
}

/** True when the axis is finer than daily (hourly, 15 min, etc.). */
export function supportsIntraDayTimePlayback(dates: Date[]): boolean {
  const stepMs = inferTimeStepMs(dates);
  return stepMs !== null && stepMs < DAY_MS;
}
