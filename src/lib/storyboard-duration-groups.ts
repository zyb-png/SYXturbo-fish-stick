export const STORYBOARD_GROUP_PREFERRED_MIN_SECONDS = 10;
export const STORYBOARD_GROUP_MAX_SECONDS = 15;
export const STORYBOARD_DURATION_GROUPING_STRATEGY = 'content-driven-max-15-v3';

const DURATION_PRECISION = 10;
const DURATION_EPSILON = 0.0001;

function roundDuration(value: number): number {
  return Math.round(value * DURATION_PRECISION) / DURATION_PRECISION;
}

export function parseStoryboardDurationSeconds(value: unknown, fallback = 3): number {
  let parsed = Number.NaN;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    const matched = value.trim().match(/\d+(?:\.\d+)?/);
    parsed = matched ? Number(matched[0]) : Number.NaN;
  }

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return roundDuration(Math.max(0.1, fallback));
  }

  return roundDuration(parsed);
}

export function sumStoryboardDurations(values: unknown[], fallback = 3): number {
  return roundDuration(
    values.reduce<number>(
      (total, value) => total + parseStoryboardDurationSeconds(value, fallback),
      0,
    ),
  );
}

export function formatStoryboardDurationSeconds(value: number): string {
  const duration = roundDuration(value);
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(1);
}

export interface StoryboardDurationGroupEntry<T> {
  item: T;
  duration: number;
}

export interface StoryboardDurationGroup<T> {
  entries: Array<StoryboardDurationGroupEntry<T>>;
  totalDuration: number;
}

interface GroupByDurationOptions<T> {
  preferredMinDuration?: number;
  maxDuration?: number;
  fallbackDuration?: number;
  getGroupKey?: (item: T) => string | number | undefined;
}

/**
 * Groups adjacent shots without reordering them. Model-planned video-unit keys
 * are authoritative. The duration fallback only prevents a group from exceeding
 * the provider limit; it never pads a short but complete unit.
 */
export function groupContiguousItemsByDuration<T>(
  items: readonly T[],
  getDuration: (item: T) => unknown,
  options: GroupByDurationOptions<T> = {},
): Array<StoryboardDurationGroup<T>> {
  const preferredMinDuration = options.preferredMinDuration
    ?? STORYBOARD_GROUP_PREFERRED_MIN_SECONDS;
  const maxDuration = options.maxDuration ?? STORYBOARD_GROUP_MAX_SECONDS;
  const fallbackDuration = options.fallbackDuration ?? 3;

  if (
    preferredMinDuration <= 0
    || maxDuration <= 0
    || preferredMinDuration > maxDuration
  ) {
    throw new Error('Invalid storyboard duration grouping range');
  }

  const normalizedEntries = items.map(item => ({
    item,
    // A single API shot cannot make a video group exceed the provider limit.
    duration: Math.min(
      maxDuration,
      parseStoryboardDurationSeconds(getDuration(item), fallbackDuration),
    ),
  }));
  const groups: Array<StoryboardDurationGroup<T>> = [];
  let currentEntries: Array<StoryboardDurationGroupEntry<T>> = [];
  let currentDuration = 0;

  const closeCurrentGroup = () => {
    if (currentEntries.length === 0) return;
    groups.push({
      entries: currentEntries,
      totalDuration: roundDuration(currentDuration),
    });
    currentEntries = [];
    currentDuration = 0;
  };

  normalizedEntries.forEach((entry, index) => {
    const currentGroupKey = currentEntries.length > 0
      ? options.getGroupKey?.(currentEntries[0].item)
      : undefined;
    const entryGroupKey = options.getGroupKey?.(entry.item);
    const startsNewPlannedUnit = currentEntries.length > 0
      && currentGroupKey !== undefined
      && entryGroupKey !== undefined
      && currentGroupKey !== entryGroupKey;

    if (startsNewPlannedUnit) {
      closeCurrentGroup();
    }

    if (
      currentEntries.length > 0
      && currentDuration + entry.duration > maxDuration + DURATION_EPSILON
    ) {
      closeCurrentGroup();
    }

    currentEntries.push(entry);
    currentDuration = roundDuration(currentDuration + entry.duration);

    const nextEntry = normalizedEntries[index + 1];
    const nextGroupKey = nextEntry ? options.getGroupKey?.(nextEntry.item) : undefined;
    const plannedUnitEnds = entryGroupKey !== undefined
      && nextGroupKey !== undefined
      && entryGroupKey !== nextGroupKey;
    const nextWouldExceed = !nextEntry
      || currentDuration + nextEntry.duration > maxDuration + DURATION_EPSILON;

    if (
      plannedUnitEnds
      || (
        currentDuration >= preferredMinDuration - DURATION_EPSILON
        && nextWouldExceed
      )
    ) {
      closeCurrentGroup();
    }
  });

  closeCurrentGroup();
  return groups;
}
