// Labels, progress and small formatters for upload queue items.

const STATUS_LABELS = {
  preparing: 'Preparing',
  queued: 'Queued',
  hashing: 'Reading',
  checking: 'Checking',
  duplicate: 'Already saved',
  'uploading-original': 'Saving original',
  'repairing-original': 'Fixing original',
  thumbnailing: 'Making cover',
  'uploading-thumbnail': 'Saving cover',
  'repairing-thumbnail': 'Fixing cover',
  registering: 'Finishing',
  complete: 'Saved',
  cancelled: 'Cancelled',
  failed: 'Needs attention'
};

const STATUS_PROGRESS = {
  preparing: 6,
  queued: 10,
  hashing: 24,
  checking: 38,
  duplicate: 100,
  'uploading-original': 58,
  'repairing-original': 58,
  thumbnailing: 72,
  'uploading-thumbnail': 86,
  'repairing-thumbnail': 86,
  registering: 94,
  complete: 100,
  cancelled: 100,
  failed: 100
};

export const CANCELLABLE_STATUSES = new Set([
  'preparing',
  'queued',
  'hashing',
  'checking',
  'uploading-original',
  'repairing-original',
  'thumbnailing',
  'uploading-thumbnail',
  'repairing-thumbnail',
  'registering'
]);

export function statusText(item) {
  return STATUS_LABELS[item.status] || item.status || 'Pending';
}

export function uploadProgress(item) {
  return STATUS_PROGRESS[item.status] ?? 0;
}

export function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return 'Unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function isVideoUpload(item) {
  return item.file.type.startsWith('video/') || /\.(webm|mp4)$/i.test(item.name);
}

export function canCancel(item) {
  return CANCELLABLE_STATUSES.has(item.status);
}

export function detailUrlForUpload(item) {
  return item.id ? `/image/${item.id}` : '';
}

/**
 * True when the file may be deleted from the phone: the upload flow ended with the server
 * confirming the item and both of its files ('complete'), or found it already saved
 * ('duplicate'), and the phone still has it.
 */
export function isDeletableFromPhone(item) {
  return Boolean(item?.sourceUri && item.id && (item.status === 'complete' || item.status === 'duplicate'));
}
