const DB_NAME = 'hornygrail-mobile';
const DB_VERSION = 1;
const STORE_NAME = 'uploadQueue';

const RESUME_AS_QUEUED_STATUSES = new Set([
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

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function openDatabase() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    });

    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error || new Error('Could not open upload queue database')));
  });
}

function runRequest(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error || new Error('IndexedDB request failed')));
  });
}

function closeDatabase(db) {
  db?.close();
}

function toStoredItem(item) {
  return {
    localId: item.localId,
    name: item.name,
    size: item.size,
    type: item.file?.type || '',
    lastModified: item.file?.lastModified || Date.now(),
    fileBlob: item.file,
    status: item.status,
    message: item.message || '',
    error: item.error || null,
    id: item.id || null,
    ext: item.ext || null,
    outcome: item.outcome || null,
    thumbnailUrl: item.thumbnailUrl || null,
    integrity: item.integrity || null
  };
}

function toRestoredItem(storedItem) {
  const file = new File([storedItem.fileBlob], storedItem.name, {
    type: storedItem.type || storedItem.fileBlob?.type || '',
    lastModified: storedItem.lastModified || Date.now()
  });
  const wasInterrupted = RESUME_AS_QUEUED_STATUSES.has(storedItem.status);

  return {
    localId: storedItem.localId,
    file,
    name: storedItem.name,
    size: storedItem.size,
    status: wasInterrupted ? 'queued' : storedItem.status,
    message: wasInterrupted ? 'Ready to resume' : storedItem.message || '',
    error: wasInterrupted ? null : storedItem.error || null,
    id: storedItem.id || null,
    ext: storedItem.ext || null,
    outcome: wasInterrupted ? null : storedItem.outcome || null,
    thumbnailUrl: wasInterrupted ? null : storedItem.thumbnailUrl || null,
    integrity: storedItem.integrity || null,
    wasInterrupted
  };
}

export async function loadPersistedUploadQueue() {
  const db = await openDatabase();
  if (!db) {
    return [];
  }

  try {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const snapshot = await runRequest(store.get('snapshot'));
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    return items.filter((item) => item?.fileBlob instanceof Blob).map(toRestoredItem);
  } finally {
    closeDatabase(db);
  }
}

export async function persistUploadQueue(items) {
  const db = await openDatabase();
  if (!db) {
    return;
  }

  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const snapshot = {
      key: 'snapshot',
      savedAt: Date.now(),
      items: items.map(toStoredItem)
    };

    await runRequest(store.put(snapshot));
  } finally {
    closeDatabase(db);
  }
}
