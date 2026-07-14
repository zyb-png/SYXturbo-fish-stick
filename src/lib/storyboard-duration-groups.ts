export const STORYBOARD_GROUP_MIN_SECONDS = 14;
export const STORYBOARD_GROUP_MAX_SECONDS = 15;
export const STORYBOARD_DURATION_GROUPING_STRATEGY = 'duration-14-15-v1';

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

interface GroupByDurationOptions {
  minDuration?: number;
  maxDuration?: number;
  fallbackDuration?: number;
}

/**
 * Groups adjacent shots without reordering them. A group closes once it reaches
 * the target window, or before the next complete shot would exceed the maximum.
 */
export function groupContiguousItemsByDuration<T>(
  items: readonly T[],
  getDuration: (item: T) => unknown,
  options: GroupByDurationOptions = {},
): Array<StoryboardDurationGroup<T>> {
  const minDuration = options.minDuration ?? STORYBOARD_GROUP_MIN_SECONDS;
  const maxDuration = options.maxDuration ?? STORYBOARD_GROUP_MAX_SECONDS;
  const fallbackDuration = options.fallbackDuration ?? 3;

  if (minDuration <= 0 || maxDuration <= 0 || minDuration > maxDuration) {
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
    if (
      currentEntries.length > 0
      && currentDuration + entry.duration > maxDuration + DURATION_EPSILON
    ) {
      closeCurrentGroup();
    }

    currentEntries.push(entry);
    currentDuration = roundDuration(currentDuration + entry.duration);

    const nextEntry = normalizedEntries[index + 1];
    const nextWouldExceed = !nextEntry
      || currentDuration + nextEntry.duration > maxDuration + DURATION_EPSILON;

    if (currentDuration >= minDuration - DURATION_EPSILON && nextWouldExceed) {
      closeCurrentGroup();
    }
  });

  closeCurrentGroup();
  return groups;
}
