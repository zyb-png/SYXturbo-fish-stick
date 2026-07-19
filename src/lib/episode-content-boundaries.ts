export type PositionedEpisodeMarker = {
  number: number;
  marker: string;
  start: number;
  end: number;
};

export type EpisodeContentRange = PositionedEpisodeMarker & {
  contentStart: number;
  contentEnd: number;
};

export function resolveEpisodeContentRanges(
  requestedEpisodeNumbers: readonly number[],
  allEpisodeMarkers: readonly PositionedEpisodeMarker[],
  sourceLength: number,
): EpisodeContentRange[] {
  const requested = new Set(
    requestedEpisodeNumbers.filter(number => Number.isFinite(number) && number > 0),
  );
  const orderedMarkers = [...allEpisodeMarkers]
    .filter(marker => (
      Number.isFinite(marker.number)
      && marker.number > 0
      && Number.isFinite(marker.start)
      && Number.isFinite(marker.end)
      && marker.start >= 0
      && marker.end >= marker.start
    ))
    .sort((left, right) => left.start - right.start);

  return orderedMarkers.flatMap((marker, index) => {
    if (!requested.has(marker.number)) return [];

    const nextMarker = orderedMarkers
      .slice(index + 1)
      .find(candidate => candidate.start > marker.start);
    const contentEnd = nextMarker?.start ?? sourceLength;
    const contentStart = Math.min(marker.end, sourceLength);

    return [{
      ...marker,
      contentStart,
      contentEnd: Math.max(contentStart, Math.min(contentEnd, sourceLength)),
    }];
  });
}
