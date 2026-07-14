export function getCanonicalEpisodeTitle(chapterNumber: unknown): string {
  const parsed = Number(chapterNumber);
  if (!Number.isFinite(parsed) || parsed <= 0) return '未识别集数';
  return `第${Math.trunc(parsed)}集`;
}

export function normalizeEpisodeChapterTitles<
  T extends { chapterNumber: number; title: string }
>(chapters: T[]): { chapters: T[]; changed: boolean } {
  let changed = false;
  const normalized = chapters.map((chapter) => {
    const title = getCanonicalEpisodeTitle(chapter.chapterNumber);
    if (chapter.title === title) return chapter;
    changed = true;
    return { ...chapter, title };
  });

  return { chapters: normalized, changed };
}
