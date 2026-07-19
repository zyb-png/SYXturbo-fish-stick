import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEpisodeContentRanges } from './episode-content-boundaries.ts';

const markers = Array.from({ length: 15 }, (_, index) => {
  const episodeNumber = index + 1;
  const start = index * 100;
  return {
    number: episodeNumber,
    marker: `第${episodeNumber}集`,
    start,
    end: start + 4,
  };
});

test('the fifth episode ends at episode six instead of the end of the source', () => {
  const ranges = resolveEpisodeContentRanges([1, 2, 3, 4, 5], markers, 1000);
  const episodeFive = ranges.find(range => range.number === 5);

  assert.ok(episodeFive);
  assert.equal(episodeFive.contentEnd, markers[5].start);
});

test('only the actual final episode ends at the end of the source', () => {
  const middleRanges = resolveEpisodeContentRanges([6, 7, 8, 9, 10], markers, 1500);
  const episodeTen = middleRanges.find(range => range.number === 10);
  const finalRanges = resolveEpisodeContentRanges([11, 12, 13, 14, 15], markers, 1500);
  const episodeFifteen = finalRanges.find(range => range.number === 15);

  assert.ok(episodeTen);
  assert.equal(episodeTen.contentEnd, markers[10].start);
  assert.ok(episodeFifteen);
  assert.equal(episodeFifteen.contentEnd, 1500);
});
