export const PAUSED_MESSAGE = 'Paused until you unlock';

export function createUploadQueueProcessor({
  getItems,
  getItem,
  updateItem,
  runFlow,
  resolveThumbnail,
  outcomeText,
  isAbortError,
  isUnauthorizedError = () => false,
  canProcess = () => true
}) {
  let processing = false;

  async function process() {
    if (processing || !canProcess()) return;
    processing = true;

    try {
      while (canProcess()) {
        const nextItem = getItems().find((item) => item.status === 'queued');
        if (!nextItem) break;

        const controller = nextItem.controller || new AbortController();
        updateItem(nextItem.localId, {
          controller,
          status: 'hashing',
          error: null,
          message: ''
        });

        try {
          const result = await runFlow(nextItem.file, (status, detail = null) => {
            updateItem(nextItem.localId, {
              status,
              id: detail?.id || getItem(nextItem.localId)?.id || null,
              integrity: detail?.integrity || getItem(nextItem.localId)?.integrity || null
            });
          }, { signal: controller.signal });

          updateItem(nextItem.localId, {
            status: result.outcome === 'duplicate' ? 'duplicate' : 'complete',
            id: result.id,
            ext: result.ext,
            outcome: result.outcome,
            integrity: result.integrity,
            thumbnailUrl: await resolveThumbnail(result.id),
            message: outcomeText(result.outcome)
          });
        } catch (error) {
          if (isAbortError(error)) {
            updateItem(nextItem.localId, {
              status: 'cancelled',
              error: null,
              message: 'Cancelled'
            });
            continue;
          }

          if (isUnauthorizedError(error)) {
            // The vault locked or the session expired. Put the file back in line; the
            // upload flow is resumable, so it picks up where it left off after unlock.
            updateItem(nextItem.localId, {
              status: 'queued',
              error: null,
              message: PAUSED_MESSAGE
            });
            break;
          }

          console.error('Upload flow failed', error);
          updateItem(nextItem.localId, {
            status: 'failed',
            error: error?.message || 'Upload failed',
            message: 'Could not save this file'
          });
        }
      }
    } finally {
      processing = false;
      if (canProcess() && getItems().some((item) => item.status === 'queued')) {
        void process();
      }
    }
  }

  return { process };
}
