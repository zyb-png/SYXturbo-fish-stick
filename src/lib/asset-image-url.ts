const LOCAL_ASSET_VIEW_PATH = '/api/assets-view';
const ASSET_PREVIEW_WIDTH = 1600;
const ASSET_PREVIEW_QUALITY = 82;

export function getAssetThumbnailUrl(
  imageUrl: string | undefined,
  width = 720,
  quality = 72,
): string {
  const value = imageUrl?.trim() || '';
  if (!value) return '';

  try {
    const isRelative = value.startsWith('/') && !value.startsWith('//');
    const parsed = new URL(value, 'http://local.asset');
    if (parsed.pathname !== LOCAL_ASSET_VIEW_PATH) return value;

    parsed.searchParams.set('thumbnail', '1');
    parsed.searchParams.set('width', String(Math.round(width)));
    parsed.searchParams.set('quality', String(Math.round(quality)));

    return isRelative
      ? `${parsed.pathname}${parsed.search}`
      : parsed.toString();
  } catch {
    return value;
  }
}

export function getAssetPreviewUrl(imageUrl: string | undefined): string {
  return getAssetThumbnailUrl(imageUrl, ASSET_PREVIEW_WIDTH, ASSET_PREVIEW_QUALITY);
}
