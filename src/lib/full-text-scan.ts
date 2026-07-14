export type FullTextChunk = {
  index: number;
  total: number;
  start: number;
  end: number;
  text: string;
};

export function splitTextForFullScan(
  rawContent: string,
  maxChunkChars = 40_000,
  overlapChars = 1_200
): FullTextChunk[] {
  const content = String(rawContent || '');
  if (!content) return [];
  if (content.length <= maxChunkChars) {
    return [{ index: 1, total: 1, start: 0, end: content.length, text: content }];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(content.length, start + maxChunkChars);
    if (end < content.length) {
      const minimumBreak = start + Math.floor(maxChunkChars * 0.7);
      const newlineBreak = content.lastIndexOf('\n', end);
      if (newlineBreak >= minimumBreak) end = newlineBreak;
    }

    if (end <= start) end = Math.min(content.length, start + maxChunkChars);
    ranges.push({ start, end });
    if (end >= content.length) break;
    start = Math.max(start + 1, end - overlapChars);
  }

  return ranges.map((range, index) => ({
    index: index + 1,
    total: ranges.length,
    start: range.start,
    end: range.end,
    text: content.slice(range.start, range.end),
  }));
}

export function selectEvenlySpaced<T>(items: T[], maxItems: number): T[] {
  if (maxItems <= 0 || items.length === 0) return [];
  if (items.length <= maxItems) return [...items];
  if (maxItems === 1) return [items[0]];

  const selected: T[] = [];
  const usedIndexes = new Set<number>();
  for (let index = 0; index < maxItems; index++) {
    const sourceIndex = Math.round((index * (items.length - 1)) / (maxItems - 1));
    if (usedIndexes.has(sourceIndex)) continue;
    usedIndexes.add(sourceIndex);
    selected.push(items[sourceIndex]);
  }
  return selected;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
