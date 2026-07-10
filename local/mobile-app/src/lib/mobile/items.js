const VIDEO_EXTENSIONS = new Set(['webm', 'mp4']);

function getExtFromStringValue(value) {
  const base = value.split('/').pop() || '';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return ext ? ext.toLowerCase() : null;
}

export function getMediaKindFromExt(ext) {
  return typeof ext === 'string' && VIDEO_EXTENSIONS.has(ext.toLowerCase()) ? 'video' : 'image';
}

export function normalizeMediaItem(item) {
  if (!item) {
    return null;
  }

  if (typeof item === 'string') {
    const base = item.split('/').pop();
    const id = base ? (base.includes('.') ? base.split('.')[0] : base) : null;
    if (!id) {
      return null;
    }

    const ext = getExtFromStringValue(item);
    return {
      id,
      ext,
      kind: getMediaKindFromExt(ext),
      dateAdded: null
    };
  }

  if (typeof item === 'object') {
    const id = item.id ?? null;
    const ext = typeof item.ext === 'string'
      ? item.ext.toLowerCase()
      : getExtFromStringValue(item.url ?? item.src ?? '');
    const dateAdded = item.dateAdded ?? item.createdAt ?? item.addedAt ?? item.date ?? item.created_at ?? null;

    if (!id) {
      return null;
    }

    return {
      id,
      ext,
      kind: getMediaKindFromExt(ext),
      dateAdded: typeof dateAdded === 'string' ? dateAdded : (dateAdded?.toString?.() ?? null)
    };
  }

  return null;
}

export function createMediaView(item) {
  const normalized = normalizeMediaItem(item);
  if (!normalized?.id || !normalized.ext) {
    return null;
  }

  const fileUrl = typeof item?.fileUrl === 'string' ? item.fileUrl : null;
  const thumbnailUrl = typeof item?.thumbnailUrl === 'string' ? item.thumbnailUrl : null;
  if (!fileUrl || !thumbnailUrl) {
    return null;
  }

  return {
    ...normalized,
    thumbnailUrl,
    fileUrl,
    detailUrl: `/image/${normalized.id}`
  };
}

export function normalizeMediaViews(payload) {
  const items = Array.isArray(payload) ? payload : (payload?.items ?? payload?.data ?? []);
  return items
    .map(createMediaView)
    .filter(Boolean);
}
