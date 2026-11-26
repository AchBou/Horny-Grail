<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { readDir, stat, watch } from "@tauri-apps/plugin-fs";
  import type { UnwatchFn } from "@tauri-apps/plugin-fs";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy, tick } from "svelte";
  import { registerUploadedFile, uploadFile } from "$lib/functions/uploadFile.js";
  import { uploadThumbnail } from "$lib/functions/uploadThumbnail.js";
  import { computeFileHash } from "$lib/functions/computeFileHash.js";
  import { checkAssetIntegrityByHex } from "$lib/functions/checkAssetIntegrity.js";
  import { deleteFromGrail } from "$lib/functions/grailItems.js";
  import { moveUploadedToRecycleBin } from "$lib/functions/recycleUploaded.js";
  import { classifyIntegrity } from "$lib/functions/uploadSafety.js";
  import { fetchTagSummary, updateItemTags } from "$lib/functions/tags.js";
  import TagEditor from "$lib/components/TagEditor.svelte";
  import WatchView from "$lib/components/WatchView.svelte";
  import { openPath } from "@tauri-apps/plugin-opener";
  import { requestVideoPreview } from "$lib/functions/videoPreview.js";
  import { join } from "@tauri-apps/api/path";


  interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    modifiedAt: number;
    size: number | null;
  }

  type FileCheckStatus = 'pending' | 'done' | 'failed';
  type FileCategory = 'checking' | 'new' | 'uploaded' | 'repair' | 'failed';
  type ListTab = 'new' | 'uploaded' | 'repair' | 'failed' | 'all';

  const LIST_TABS: { id: ListTab; label: string; empty: string }[] = [
    { id: 'new', label: 'New', empty: 'No new files to upload.' },
    { id: 'uploaded', label: 'Uploaded', empty: 'Nothing from this folder is uploaded yet.' },
    { id: 'repair', label: 'Needs repair', empty: 'No uploaded files are missing parts.' },
    { id: 'failed', label: 'Failed', empty: 'No failed checks or uploads.' },
    { id: 'all', label: 'All', empty: 'No media files in this folder.' }
  ];

  let selectedPath = $state("");
  let files = $state<FileEntry[]>([]);
  let isLoading = $state(false);
  let errorMessage = $state("");
  let unwatchFn: UnwatchFn | null = $state(null);
  let lastChangeDetected = $state<Date | null>(null);
  let isWatching = $state(false);
  let updateTimeout: number | null = $state(null);
  let pendingUpdates = $state(0);
  let isUploading = $state(false);
  let uploadStatus = $state<{[key: string]: string}>({});
  let fileHashes = $state<{[key: string]: string}>({});
  let fileExists = $state<{[key: string]: boolean}>({});
  let fileCheckStatus = $state<{[key: string]: FileCheckStatus}>({});
  let fileRepairNeeded = $state<{[key: string]: boolean}>({});
  let fileMissingParts = $state<{[key: string]: string[]}>({});
  let isScanningMetadata = $state(false);
  let scannedMetadataCount = $state(0);
  let totalMetadataCount = $state(0);
  let copiedFilePath = $state("");
  let copiedFileTimeout: number | null = $state(null);
  let scanGeneration = 0;
  // Date and size per path, so watcher refreshes only stat files that changed.
  const fileDetailsCache = new Map<string, { modifiedAt: number; size: number | null }>();
  let activeTab = $state<ListTab>('new');
  let previewFailed = $state<{[key: string]: boolean}>({});
  let currentUpload = $state<{ path: string; name: string; index: number; total: number } | null>(null);

  // What happens to a file once it is safely in the Grail. Remembered between launches;
  // Recycle Bin by default, since the Grail is meant to be the only copy.
  type AfterUpload = 'keep' | 'recycle';
  const AFTER_UPLOAD_KEY = 'hornygrail-after-upload';
  let afterUpload = $state<AfterUpload>(
    typeof localStorage !== 'undefined' && localStorage.getItem(AFTER_UPLOAD_KEY) === 'keep' ? 'keep' : 'recycle'
  );
  // The row whose tag field has focus shows the quick tag bubbles; other rows stay compact.
  let focusedRow = $state<string | null>(null);
  $effect(() => {
    localStorage.setItem(AFTER_UPLOAD_KEY, afterUpload);
  });
  let isRemoving = $state(false);
  let noticeMessage = $state("");

  // Tags. New files carry the tags typed on their row plus the batch tags until they upload;
  // files already in the Grail show and edit their saved tags directly.
  type AppView = 'upload' | 'watch';
  let appView = $state<AppView>('upload');
  let batchTags = $state<string[]>([]);
  let pendingTags = $state<{[path: string]: string[]}>({});
  let savedTags = $state<{[path: string]: string[]}>({});
  let tagSuggestions = $state<string[]>([]);

  async function refreshTagSuggestions(): Promise<void> {
    try {
      tagSuggestions = (await fetchTagSummary()).tags.map((entry) => entry.tag);
    } catch (error) {
      console.warn("Could not load tag suggestions", error);
    }
  }
  void refreshTagSuggestions();

  function rememberTags(tags: string[]): void {
    const missing = tags.filter((tag) => !tagSuggestions.includes(tag));
    if (missing.length) tagSuggestions = [...tagSuggestions, ...missing];
  }

  function tagsForUpload(file: FileEntry): string[] {
    return [...new Set([...batchTags, ...(pendingTags[file.path] || [])])];
  }

  function addPendingTags(file: FileEntry, tags: string[]): void {
    pendingTags[file.path] = [...new Set([...(pendingTags[file.path] || []), ...tags])];
  }

  function removePendingTag(file: FileEntry, tag: string): void {
    pendingTags[file.path] = (pendingTags[file.path] || []).filter((value) => value !== tag);
  }

  async function changeSavedTags(file: FileEntry, change: { add?: string[]; remove?: string[] }): Promise<void> {
    const hash = fileHashes[file.path];
    if (!hash) return;
    // Show the change at once and keep the box usable; saves run in order per item.
    const before = savedTags[file.path] || [];
    const removed = new Set(change.remove || []);
    savedTags[file.path] = [
      ...before.filter((tag) => !removed.has(tag)),
      ...(change.add || []).filter((tag) => !before.includes(tag))
    ];
    rememberTags(change.add || []);
    try {
      savedTags[file.path] = await updateItemTags(hash, change);
    } catch (error) {
      savedTags[file.path] = before;
      errorMessage = `Could not save tags for ${file.name}: ${getErrorDetail(error)}`;
    }
  }

  async function openLocalFile(file: FileEntry): Promise<void> {
    try {
      await openPath(file.path);
    } catch (error) {
      errorMessage = `Could not open ${file.name}: ${getErrorDetail(error)}`;
    }
  }

  // Files that are uploaded and complete in the Grail, so they can leave this PC.
  const removableFiles = $derived(files.filter((file) => getFileCategory(file) === 'uploaded' && fileHashes[file.path]));

  // Which list tab a file belongs to. A file stays in "New" while it uploads, then moves on.
  function getFileCategory(file: FileEntry): FileCategory {
    if (uploadStatus[file.path] === 'failed' || fileCheckStatus[file.path] === 'failed') return 'failed';
    if (fileCheckStatus[file.path] !== 'done') return 'checking';
    if (fileExists[file.path]) return fileRepairNeeded[file.path] ? 'repair' : 'uploaded';
    return 'new';
  }

  const tabCounts = $derived.by(() => {
    const counts: Record<ListTab, number> = { new: 0, uploaded: 0, repair: 0, failed: 0, all: files.length };
    for (const file of files) {
      const category = getFileCategory(file);
      if (category !== 'checking') counts[category] += 1;
    }
    return counts;
  });

  // Newest first, so files just added to the folder are at the top.
  const visibleFiles = $derived(
    files
      .filter((file) => activeTab === 'all' || getFileCategory(file) === activeTab)
      .sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
  );

  function canPreview(file: { name: string; path: string }): boolean {
    const ext = getFileExt(file.name);
    return !isVideoExt(ext) && ext !== 'tif' && ext !== 'tiff' && !previewFailed[file.path];
  }

  // Video rows show a frame from the file once the row scrolls into view.
  let videoPreviews = $state<{[path: string]: string}>({});
  let videoPreviewFailed = $state<{[path: string]: boolean}>({});

  function isVideoFile(name: string): boolean {
    return isVideoExt(getFileExt(name));
  }

  function lazyVideoPreview(node: HTMLElement, file: { path: string; modifiedAt?: number }) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      requestVideoPreview(file.path, file.modifiedAt || 0)
        .then((url) => { videoPreviews[file.path] = url; })
        .catch((error) => {
          console.warn("No preview frame for", file.path, error);
          videoPreviewFailed[file.path] = true;
        });
    }, { rootMargin: "300px" });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function formatFileDetails(file: FileEntry): string {
    const parts: string[] = [];
    if (file.modifiedAt) {
      parts.push(new Date(file.modifiedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    }
    if (typeof file.size === 'number') {
      parts.push(file.size >= 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(file.size / 1024))} KB`);
    }
    return parts.join(' · ');
  }

  // Keep the file being uploaded in view.
  $effect(() => {
    const path = currentUpload?.path;
    if (!path) return;
    tick().then(() => {
      document.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });

  // Only process and show supported media files.
  const mediaExtensions = ['jpg','jpeg','png','gif','webp','bmp','tiff','tif','webm','mp4'];
  function isMediaFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return mediaExtensions.includes(ext);
  }

  // Map image file extensions to simple emoji icons
  const extIconMap: { [key: string]: string } = {
    jpg: '📷',
    jpeg: '📷',
    png: '🖼️',
    gif: '🎞️',
    webp: '🧩',
    bmp: '🧱',
    tiff: '📐',
    tif: '📐',
    webm: '🎬',
    mp4: '🎬'
  };

  function getFileExt(name: string): string {
    return name.split('.').pop()?.toLowerCase() || '';
  }

  function isVideoExt(ext: string): boolean {
    return ext === "webm" || ext === "mp4";
  }

  function getErrorDetail(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }

  function formatUploadFailureMessage(file: FileEntry, prefix: string, error: unknown): string {
    const detail = getErrorDetail(error);
    const normalized = detail.toLowerCase();

    if (
      isVideoExt(getFileExt(file.name)) &&
      (
        normalized.includes("invalid data found when processing input") ||
        normalized.includes("ebml header parsing failed") ||
        normalized.includes("error opening input file") ||
        normalized.includes("moov atom not found")
      )
    ) {
      return `${prefix} ${file.name}: the source video is corrupted or not a valid video file, so the thumbnail cannot be regenerated until the file is replaced.`;
    }

    return `${prefix} ${file.name}: ${detail}`;
  }

  function getIconForFile(name: string): string {
    const ext = getFileExt(name);
    return extIconMap[ext] || '🖼️';
  }

  function resetFileMetadata(paths: string[]): void {
    if (paths.length === 0) return;

    const nextHashes = { ...fileHashes };
    const nextExists = { ...fileExists };
    const nextStatus = { ...fileCheckStatus };
    const nextRepairNeeded = { ...fileRepairNeeded };
    const nextMissingParts = { ...fileMissingParts };
    for (const rawPath of paths) {
      const normalized = rawPath.replace(/\//g, '\\');
      fileDetailsCache.delete(normalized);
      delete nextHashes[normalized];
      delete nextExists[normalized];
      delete nextStatus[normalized];
      delete nextRepairNeeded[normalized];
      delete nextMissingParts[normalized];
    }

    fileHashes = nextHashes;
    fileExists = nextExists;
    fileCheckStatus = nextStatus;
    fileRepairNeeded = nextRepairNeeded;
    fileMissingParts = nextMissingParts;
  }

  async function hydrateFileMetadata(filesToCheck: FileEntry[], generation: number): Promise<void> {
    if (filesToCheck.length === 0) {
      if (generation === scanGeneration) {
        isScanningMetadata = false;
        scannedMetadataCount = 0;
        totalMetadataCount = 0;
      }
      return;
    }

    isScanningMetadata = true;
    scannedMetadataCount = 0;
    totalMetadataCount = filesToCheck.length;

    const derived = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? Math.floor(navigator.hardwareConcurrency / 2)
      : 4;
    const maxConcurrency = Math.max(2, Math.min(6, derived || 4));
    let idx = 0;

    const worker = async () => {
      while (true) {
        if (generation !== scanGeneration) return;

        const i = idx++;
        if (i >= filesToCheck.length) return;

        const f = filesToCheck[i];
        try {
          const hex = await computeFileHash(f.path);
          const integrity = await checkAssetIntegrityByHex(hex);
          if (!integrity) {
            throw new Error("Integrity check failed");
          }
          const state = classifyIntegrity(integrity);
          if (generation !== scanGeneration) return;

          fileHashes[f.path] = hex;
          fileExists[f.path] = state.exists;
          fileCheckStatus[f.path] = 'done';
          fileRepairNeeded[f.path] = state.repairNeeded;
          fileMissingParts[f.path] = state.missing;
          savedTags[f.path] = state.tags;
        } catch (e) {
          console.error('Existence check failed for', f.path, e);
          if (generation !== scanGeneration) return;

          fileExists[f.path] = false;
          fileCheckStatus[f.path] = 'failed';
          fileRepairNeeded[f.path] = false;
          fileMissingParts[f.path] = [];
          errorMessage ||= "Some files could not be checked. Recheck before uploading them.";
        } finally {
          if (generation === scanGeneration) {
            scannedMetadataCount += 1;
          }
        }
      }
    };

    try {
      const workerCount = Math.min(maxConcurrency, filesToCheck.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
      if (generation === scanGeneration) {
        isScanningMetadata = false;
        void recycleFilesAlreadyInGrail();
      }
    }
  }

  async function recheckExistingFiles(): Promise<void> {
    if (!selectedPath || files.length === 0) {
      return;
    }

    errorMessage = "";
    scanGeneration += 1;
    const currentGeneration = scanGeneration;
    const visibleFiles = files.filter((file) => !file.isDirectory && isMediaFile(file.name));
    const nextStatus = { ...fileCheckStatus };

    for (const file of visibleFiles) {
      delete fileHashes[file.path];
      delete fileExists[file.path];
      delete fileRepairNeeded[file.path];
      delete fileMissingParts[file.path];
      nextStatus[file.path] = 'pending';
    }

    fileCheckStatus = nextStatus;
    await hydrateFileMetadata(visibleFiles, currentGeneration);
  }

  async function selectFolder(): Promise<void> {
    try {
      errorMessage = "";
      isLoading = true;
      
      // Unwatch previous folder if any
      if (unwatchFn) {
        unwatchFn();
        unwatchFn = null;
      }
      
      // Reset watching state
      isWatching = false;
      lastChangeDetected = null;
      
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select a folder"
      });

      if (selected) {
        selectedPath = selected;
        await loadFiles(selected);
        
        // Set up file watcher for the selected directory
        await setupFileWatcher(selected);
      }
    } catch (error) {
      console.error("Error selecting folder:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errorMessage = `Error selecting folder: ${errorMsg}`;
    } finally {
      isLoading = false;
    }
  }

  async function setupFileWatcher(path: string): Promise<void> {
    try {
      // Normalize path for Windows
      const normalizedPath = path.replace(/\//g, '\\');
      
      // Set up a file watcher for the directory
      unwatchFn = await watch(normalizedPath, async (event) => {
        try {
          // Update last change timestamp
          lastChangeDetected = new Date();
          
          resetFileMetadata((event.paths || []).map((path) => path.replace(/\//g, '\\')));
          
          // Increment pending updates counter
          pendingUpdates++;
          
          // Throttle updates to prevent excessive UI refreshes
          if (updateTimeout) {
            // Clear existing timeout if there's one
            clearTimeout(updateTimeout);
          }
          
          // Set a new timeout to update files after a delay
          updateTimeout = setTimeout(async () => {
            try {
              // Refresh in place: keep the list on screen and only re-check changed files.
              await loadFiles(normalizedPath, { quiet: true });
            } catch (timeoutError) {
              console.error("Error in delayed file update:", timeoutError);
            } finally {
              // Reset pending updates counter
              pendingUpdates = 0;
              updateTimeout = null;
            }
          }, 500) as unknown as number; // TypeScript needs this cast for setTimeout
        } catch (eventError) {
          console.error("Error handling file system event:", eventError);
          const eventErrorMsg = eventError instanceof Error ? eventError.message : "Unknown error";
          errorMessage = `Error handling file system event: ${eventErrorMsg}`;
          // Don't stop watching on event errors
        }
      }, {
        recursive: false, // The list only shows this folder's own files

        delayMs: 300 // Increased debounce delay for better performance
      });
      
      // Set watching state to true
      isWatching = true;
    } catch (error) {
      console.error("Error setting up file watcher:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errorMessage = `Error setting up file watcher: ${errorMsg}`;
      isWatching = false;
    }
  }

  async function loadFiles(path: string, { quiet = false }: { quiet?: boolean } = {}): Promise<void> {
    try {
      if (!quiet) {
        errorMessage = "";
        isLoading = true;
      }
      scanGeneration += 1;
      const currentGeneration = scanGeneration;
      isScanningMetadata = false;
      scannedMetadataCount = 0;
      totalMetadataCount = 0;
      
      const normalizedPath = path.replace(/\//g, '\\');
      const entries = await readDir(normalizedPath);
      
      const mapped = await Promise.all(entries.map(async (entry) => {
        // Resolve entry path robustly:
        // - Use entry.path if provided by readDir
        // - Otherwise, join the directory path and entry name using Tauri's path API
        let entryPath = (entry as any).path || "";
        if (!entryPath || !/^[A-Za-z]:[\\\/]/.test(entryPath)) {
          try {
            entryPath = await join(normalizedPath, entry.name || "");
          } catch {
            entryPath = normalizedPath + '\\' + (entry.name || '');
          }
        }
        // Normalize to backslashes for Windows
        entryPath = entryPath.replace(/\//g, '\\');

        let details = fileDetailsCache.get(entryPath) || { modifiedAt: 0, size: null as number | null };
        if (!entry.isDirectory && isMediaFile(entry.name || '') && !fileDetailsCache.has(entryPath)) {
          try {
            const info = await stat(entryPath);
            details = { modifiedAt: info.mtime ? new Date(info.mtime).getTime() : 0, size: info.size };
            fileDetailsCache.set(entryPath, details);
          } catch (statError) {
            console.warn("Could not read file details for", entryPath, statError);
          }
        }
        const { modifiedAt, size } = details;

        return {
          name: entry.name || '',
          path: entryPath,
          isDirectory: entry.isDirectory,
          modifiedAt,
          size
        };
      }));
      
      // Show only image files (skip folders and non-images)
      const visibleFiles = mapped.filter(f => !f.isDirectory && isMediaFile(f.name));
      files = visibleFiles;

      const nextStatus = {} as {[key: string]: FileCheckStatus};
      const filesToCheck: FileEntry[] = [];
      for (const file of visibleFiles) {
        const hasCachedMetadata = typeof fileHashes[file.path] === 'string' && typeof fileExists[file.path] === 'boolean';
        nextStatus[file.path] = hasCachedMetadata ? 'done' : 'pending';
        if (!hasCachedMetadata) {
          filesToCheck.push(file);
        }
      }
      fileCheckStatus = nextStatus;

      void hydrateFileMetadata(filesToCheck, currentGeneration);
    } catch (error) {
      console.error("Error loading files:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errorMessage = `Error loading files: ${errorMsg}`;
      if (!quiet) files = [];
    } finally {
      if (!quiet) isLoading = false;
    }
  }

  // Function to upload a file
  async function handleFileUpload(file: FileEntry): Promise<void> {
    if (file.isDirectory) {
      return; // Skip directories
    }
    if (!isMediaFile(file.name)) {
      return; // Skip unsupported files
    }
    try {
      // Update status
      uploadStatus[file.path] = "uploading";
      isUploading = true;
      
      // Upload the file
      const fileHash = fileHashes[file.path] || await computeFileHash(file.path);
      await uploadFile(file.path, fileHash, { registerMetadata: false });
      fileHashes[file.path] = fileHash;
      fileCheckStatus[file.path] = "done";
      
      // Upload a thumbnail preview for every supported media file.
      const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
      
      if (mediaExtensions.includes(fileExt)) {
        try {
          await uploadThumbnail(file.path, fileHash);
        } catch (thumbnailError) {
          console.error("Error uploading thumbnail:", thumbnailError);
          fileRepairNeeded[file.path] = true;
          fileMissingParts[file.path] = ["thumbnail"];
          errorMessage = `Uploaded ${file.name}, but thumbnail generation/upload failed: ${thumbnailError instanceof Error ? thumbnailError.message : "Unknown error"}`;
          throw thumbnailError;
        }
      }
      const tags = tagsForUpload(file);
      await registerUploadedFile(fileHash, fileExt, tags);
      savedTags[file.path] = tags;
      delete pendingTags[file.path];
      rememberTags(tags);
      fileExists[file.path] = true;
      fileRepairNeeded[file.path] = false;
      fileMissingParts[file.path] = [];

      // Update status
      uploadStatus[file.path] = "completed";

    } catch (error) {
      console.error("Error uploading file:", error);
      uploadStatus[file.path] = "failed";
      errorMessage = `Failed to upload ${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`;
    } finally {
      // Check if all uploads are complete
      const activeUploads = Object.values(uploadStatus).filter(status => status === "uploading");
      if (activeUploads.length === 0) {
        isUploading = false;
      }
    }
  }

  async function copyFileName(file: FileEntry): Promise<void> {
    try {
      await navigator.clipboard.writeText(file.name);
      copiedFilePath = file.path;

      if (copiedFileTimeout) {
        clearTimeout(copiedFileTimeout);
      }

      copiedFileTimeout = window.setTimeout(() => {
        copiedFilePath = "";
        copiedFileTimeout = null;
      }, 1400);
    } catch (error) {
      console.error("Failed to copy filename:", error);
      errorMessage = `Failed to copy ${file.name}: ${error instanceof Error ? error.message : "Clipboard unavailable"}`;
    }
  }

  async function handleFileRepair(file: FileEntry): Promise<void> {
    if (file.isDirectory || !isMediaFile(file.name)) {
      return;
    }

    try {
      uploadStatus[file.path] = "repairing";
      isUploading = true;

      const fileHash = fileHashes[file.path] || await computeFileHash(file.path);
      const integrity = await checkAssetIntegrityByHex(fileHash);

      if (!integrity?.metadataExists) {
        await handleFileUpload(file);
        return;
      }

      if (!integrity.originalExists) {
        await uploadFile(file.path, fileHash);
      }

      if (!integrity.thumbnailExists) {
        await uploadThumbnail(file.path, fileHash);
      }

      fileHashes[file.path] = fileHash;
      fileExists[file.path] = true;
      fileCheckStatus[file.path] = "done";
      fileRepairNeeded[file.path] = false;
      fileMissingParts[file.path] = [];
      uploadStatus[file.path] = "completed";
    } catch (error) {
      console.error("Error repairing file:", error);
      uploadStatus[file.path] = "failed";
      errorMessage = formatUploadFailureMessage(file, "Failed to repair", error);
    } finally {
      const activeUploads = Object.values(uploadStatus).filter((status) => status === "uploading" || status === "repairing");
      if (activeUploads.length === 0) {
        isUploading = false;
      }
    }
  }

  async function refreshFileIntegrity(filePath: string, fileHash: string): Promise<void> {
    try {
      const integrity = await checkAssetIntegrityByHex(fileHash);
      fileHashes[filePath] = fileHash;
      fileExists[filePath] = true;
      fileCheckStatus[filePath] = "done";
      fileRepairNeeded[filePath] = Boolean(integrity?.repairRequired);
      fileMissingParts[filePath] = Array.isArray(integrity?.missing) ? integrity.missing : [];
    } catch (error) {
      console.error("Error refreshing file integrity:", error);
    }
  }

  async function handleThumbnailRegeneration(file: FileEntry): Promise<void> {
    if (file.isDirectory || !isMediaFile(file.name)) {
      return;
    }

    try {
      uploadStatus[file.path] = "thumbnailing";
      isUploading = true;

      const fileHash = fileHashes[file.path] || await computeFileHash(file.path);
      await uploadThumbnail(file.path, fileHash);

      fileHashes[file.path] = fileHash;
      fileExists[file.path] = true;
      fileCheckStatus[file.path] = "done";
      fileRepairNeeded[file.path] = false;
      fileMissingParts[file.path] = [];
      uploadStatus[file.path] = "completed";
      void refreshFileIntegrity(file.path, fileHash);
    } catch (error) {
      console.error("Error regenerating thumbnail:", error);
      uploadStatus[file.path] = "failed";
      errorMessage = formatUploadFailureMessage(file, "Failed to regenerate thumbnail for", error);
    } finally {
      const activeUploads = Object.values(uploadStatus).filter((status) =>
        status === "uploading" || status === "repairing" || status === "thumbnailing"
      );
      if (activeUploads.length === 0) {
        isUploading = false;
      }
    }
  }

  async function handleDeleteFromGrail(file: FileEntry): Promise<void> {
    if (file.isDirectory || !isMediaFile(file.name)) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${file.name} from the Grail?\n\nIt disappears from every app now. You can restore it for 30 days from Watch → Deleted, or by uploading this file again. The file on this PC is not touched.`
    );
    if (!confirmed) {
      return;
    }

    try {
      uploadStatus[file.path] = "purging";
      isUploading = true;

      const fileHash = fileHashes[file.path] || await computeFileHash(file.path);
      await deleteFromGrail(fileHash);

      fileHashes[file.path] = fileHash;
      fileExists[file.path] = false;
      fileCheckStatus[file.path] = "done";
      fileRepairNeeded[file.path] = false;
      fileMissingParts[file.path] = [];
      savedTags[file.path] = [];
      // Back to "New": uploading it again restores it in the Grail.
      delete uploadStatus[file.path];
      errorMessage = "";
      noticeMessage = `Deleted ${file.name} from the Grail. Restore it from Watch → Deleted within 30 days.`;
    } catch (error) {
      console.error("Error deleting from the Grail:", error);
      uploadStatus[file.path] = "failed";
      errorMessage = `Failed to delete ${file.name} from the Grail: ${getErrorDetail(error)}`;
    } finally {
      const activeUploads = Object.values(uploadStatus).filter((status) =>
        status === "uploading" || status === "repairing" || status === "thumbnailing" || status === "purging"
      );
      if (activeUploads.length === 0) {
        isUploading = false;
      }
    }
  }

  // Compute list of files eligible for bulk upload
  function getEligibleFiles(): FileEntry[] {
    return files.filter(
      (f) =>
        !f.isDirectory &&
        isMediaFile(f.name) &&
        fileCheckStatus[f.path] === "done" &&
        !fileExists[f.path] &&
        uploadStatus[f.path] !== "completed"
    );
  }

  // Upload all eligible files sequentially
  async function handleUploadAll(): Promise<void> {
    try {
      errorMessage = "";
      noticeMessage = "";
      if (activeTab !== 'all') activeTab = 'new';
      const eligible = [...getEligibleFiles()].sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
      let uploaded = 0;
      let recycled = 0;
      for (const [index, f] of eligible.entries()) {
        currentUpload = { path: f.path, name: f.name, index: index + 1, total: eligible.length };
        await handleFileUpload(f);
        if (uploadStatus[f.path] === 'completed') uploaded += 1;
        recycled += await recycleAfterUpload(f);
      }
      if (uploaded > 0) {
        noticeMessage = `Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}` +
          (recycled > 0 ? `, moved ${recycled} to the Recycle Bin.` : '.');
      }
    } catch (e) {
      console.error("Error in Upload All:", e);
      const msg = e instanceof Error ? e.message : "Unknown error";
      errorMessage = `Upload All failed: ${msg}`;
    } finally {
      currentUpload = null;
    }
  }

  async function handleSingleUpload(file: FileEntry): Promise<void> {
    currentUpload = { path: file.path, name: file.name, index: 1, total: 1 };
    try {
      await handleFileUpload(file);
      await recycleAfterUpload(file);
    } finally {
      if (currentUpload?.path === file.path) currentUpload = null;
    }
  }

  /**
   * With "Move to Recycle Bin" on, files the scan found already in the Grail leave the PC too,
   * not only the ones uploaded now. Each is checked with the Grail and re-hashed first.
   */
  async function recycleFilesAlreadyInGrail(): Promise<void> {
    if (afterUpload !== 'recycle' || isUploading || isRemoving || currentUpload) return;
    const targets = [...removableFiles];
    if (targets.length === 0) return;
    const moved = await removeFromPc(targets, { quiet: true });
    if (moved > 0) {
      noticeMessage = `Moved ${moved} file${moved === 1 ? '' : 's'} already in the Grail to the Recycle Bin.`;
    }
  }

  function setAfterUpload(value: AfterUpload): void {
    afterUpload = value;
    if (value === 'recycle') void recycleFilesAlreadyInGrail();
  }

  async function handleRepairAll(): Promise<void> {
    const targets = files.filter((file) => getFileCategory(file) === 'repair');
    for (const [index, file] of targets.entries()) {
      currentUpload = { path: file.path, name: file.name, index: index + 1, total: targets.length };
      await handleFileRepair(file);
    }
    currentUpload = null;
    // Repaired items are complete in the Grail, so they leave the PC like uploads do.
    await recycleFilesAlreadyInGrail();
  }

  async function handleSingleRepair(file: FileEntry): Promise<void> {
    await handleFileRepair(file);
    await recycleAfterUpload(file);
  }

  // With "Move to Recycle Bin" on, a file leaves the PC as soon as its upload completes.
  async function recycleAfterUpload(file: FileEntry): Promise<number> {
    if (afterUpload === 'recycle' && uploadStatus[file.path] === 'completed') {
      return removeFromPc([file], { quiet: true });
    }
    return 0;
  }

  /**
   * Moves files to the Recycle Bin once the Grail confirms it holds them. Each file is
   * checked with the server and re-hashed first; anything not confirmed stays on the PC.
   */
  async function removeFromPc(targets: FileEntry[], { quiet = false } = {}): Promise<number> {
    if (!selectedPath || targets.length === 0) return 0;

    const removable = targets.filter((file) => fileHashes[file.path]);
    if (removable.length === 0) return 0;

    for (const file of removable) uploadStatus[file.path] = 'removing';
    isRemoving = true;
    try {
      const { moved, errors } = await moveUploadedToRecycleBin(
        selectedPath,
        removable.map((file) => ({ path: file.path, name: file.name, hash: fileHashes[file.path] }))
      );

      const movedSet = new Set(moved.map((path) => path.replace(/\//g, '\\')));
      files = files.filter((file) => !movedSet.has(file.path));
      resetFileMetadata([...movedSet]);
      for (const file of removable) {
        if (movedSet.has(file.path)) delete uploadStatus[file.path];
        else uploadStatus[file.path] = 'completed';
      }

      if (errors.length > 0) {
        errorMessage = `Kept ${errors.length} file${errors.length === 1 ? '' : 's'} on this PC: ${errors.join('; ')}`;
      }
      if (moved.length > 0 && !quiet) {
        noticeMessage = `Moved ${moved.length} file${moved.length === 1 ? '' : 's'} to the Recycle Bin.`;
      }
      return moved.length;
    } catch (error) {
      console.error("Error removing files from PC:", error);
      for (const file of removable) uploadStatus[file.path] = 'completed';
      errorMessage = `Could not remove files from this PC: ${getErrorDetail(error)}`;
      return 0;
    } finally {
      isRemoving = false;
    }
  }

  async function handleRemoveAllUploaded(): Promise<void> {
    const targets = [...removableFiles];
    const confirmed = window.confirm(
      `Move ${targets.length} uploaded file${targets.length === 1 ? '' : 's'} to the Recycle Bin?\n\n` +
      `They are saved in the Grail. Each file is checked with the Grail again before it is moved, ` +
      `and you can restore them from the Recycle Bin.`
    );
    if (confirmed) {
      noticeMessage = "";
      await removeFromPc(targets);
    }
  }

  // Clean up watcher and any pending timeouts when component is destroyed
  onDestroy(() => {
    if (unwatchFn) {
      unwatchFn();
      unwatchFn = null;
      isWatching = false;
    }
    
    // Clear any pending timeouts
    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }

    if (copiedFileTimeout) {
      clearTimeout(copiedFileTimeout);
      copiedFileTimeout = null;
    }
  });
</script>

<main class="container">
  <div class="brand-header">
    <img
      class="brand-logo"
      src="/brand/horny-grail-uploader.svg"
      alt=""
      width="76"
      height="76"
    />
    <h1 class="app-title">Grail Uploader</h1>
    <div class="view-switch" role="tablist" aria-label="Choose a view">
      <button role="tab" aria-selected={appView === 'upload'} class:selected={appView === 'upload'} onclick={() => appView = 'upload'}>Upload</button>
      <button role="tab" aria-selected={appView === 'watch'} class:selected={appView === 'watch'} onclick={() => appView = 'watch'}>Watch</button>
    </div>
  </div>

  {#if appView === 'watch'}
    <WatchView {tagSuggestions} onTagsSaved={rememberTags} />
  {/if}

  <div class="file-explorer" class:hidden-view={appView !== 'upload'}>
    <div class="controls">
      <button onclick={selectFolder} class="secondary-button" title="Choose a folder to watch and upload">
        {selectedPath ? 'Change folder' : 'Choose folder'}
      </button>
      {#if selectedPath}
        <span class="selected-path" title={selectedPath}>{selectedPath}</span>
        <span class="watch-status" class:watching={isWatching} title={isWatching ? 'New files in this folder show up on their own' : 'Not watching this folder'}>
          <span class="watch-indicator"></span>{isWatching ? 'Watching' : 'Not watching'}
        </span>
        <button
          onclick={recheckExistingFiles}
          class="icon-button"
          disabled={isScanningMetadata || isLoading}
          title="Check every file in this folder against the Grail again"
          aria-label="Recheck files"
        >↻</button>
      {/if}
      <div class="after-upload" role="radiogroup" aria-label="After upload" title="What happens to a file on this PC once it is safely in the Grail">
        <span>After upload</span>
        <button role="radio" aria-checked={afterUpload === 'recycle'} class:selected={afterUpload === 'recycle'} onclick={() => setAfterUpload('recycle')}>Move to Recycle Bin</button>
        <button role="radio" aria-checked={afterUpload === 'keep'} class:selected={afterUpload === 'keep'} onclick={() => setAfterUpload('keep')}>Keep on PC</button>
      </div>
    </div>

    {#if errorMessage}
      <div class="error-message">
        <p>{errorMessage}</p>
        <button class="close-error" onclick={() => errorMessage = ""} aria-label="Dismiss">×</button>
      </div>
    {/if}

    {#if noticeMessage}
      <div class="notice-message" role="status">
        <p>{noticeMessage}</p>
        <button class="close-notice" onclick={() => noticeMessage = ""} aria-label="Dismiss">×</button>
      </div>
    {/if}

    {#if isScanningMetadata}
      <p class="scan-status">Checking files against the Grail… {scannedMetadataCount}/{totalMetadataCount}</p>
    {/if}

    {#if files.length > 0}
      <div class="list-tabs" role="tablist" aria-label="Filter files">
        {#each LIST_TABS as tab (tab.id)}
          <button
            role="tab"
            aria-selected={activeTab === tab.id}
            class="list-tab"
            class:selected={activeTab === tab.id}
            class:alert={(tab.id === 'failed' || tab.id === 'repair') && tabCounts[tab.id] > 0}
            onclick={() => activeTab = tab.id}
          >
            {tab.label} <span class="tab-count">{tabCounts[tab.id]}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if selectedPath && (activeTab === 'new' || activeTab === 'all') && tabCounts.new > 0}
      <div class="batch-tags">
        <span class="batch-tags-label" title="Every file you upload from this folder gets these tags, plus the tags on its own row">Tags for all new files</span>
        <TagEditor
          tags={batchTags}
          suggestions={tagSuggestions}
          placeholder="Tags for every file in this upload…"
          onAdd={(tags) => batchTags = [...new Set([...batchTags, ...tags])]}
          onRemove={(tag) => batchTags = batchTags.filter((value) => value !== tag)}
          quickCount={10}
          disabled={isUploading}
        />
      </div>
    {/if}

    {#if currentUpload}
      <div class="now-uploading" aria-live="polite">
        {#if canPreview(currentUpload)}
          <img class="now-uploading-preview" src={convertFileSrc(currentUpload.path)} alt="" decoding="async" />
        {:else if videoPreviews[currentUpload.path]}
          <img class="now-uploading-preview" src={videoPreviews[currentUpload.path]} alt="" decoding="async" />
        {:else}
          <span class="now-uploading-preview file-preview-icon">{getIconForFile(currentUpload.name)}</span>
        {/if}
        <div class="now-uploading-text">
          <span class="now-uploading-label">
            {uploadStatus[currentUpload.path] === 'repairing' ? 'Repairing' : 'Uploading'} {currentUpload.total > 1 ? `${currentUpload.index} of ${currentUpload.total}` : ''}
          </span>
          <span class="now-uploading-name" title={currentUpload.name}>{currentUpload.name}</span>
          {#if currentUpload.total > 1}
            <div class="now-uploading-progress">
              <div style={`width: ${((currentUpload.index - 1) / currentUpload.total) * 100}%`}></div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div class="file-list">
      {#if isLoading}
        <p class="empty-tab">Loading files…</p>
      {:else if files.length === 0}
        <p class="empty-tab">{selectedPath ? 'No media files in this folder.' : 'Choose a folder to see its files.'}</p>
      {:else if visibleFiles.length === 0}
        <p class="empty-tab">
          {LIST_TABS.find((tab) => tab.id === activeTab)?.empty}
          {#if activeTab === 'new' && isScanningMetadata}Still checking the rest of the folder…{/if}
        </p>
      {:else}
        <ul>
          {#each visibleFiles as file (file.path)}
            {@const busy = uploadStatus[file.path] === "uploading" || uploadStatus[file.path] === "repairing" || uploadStatus[file.path] === "thumbnailing" || uploadStatus[file.path] === "purging"}
            <li
              class="file-item"
              class:active={currentUpload?.path === file.path}
              class:failed={getFileCategory(file) === 'failed'}
              data-path={file.path}
              onfocusin={() => focusedRow = file.path}
              onfocusout={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusedRow = null; }}
            >
              <button
                class="preview-button"
                type="button"
                onclick={() => openLocalFile(file)}
                title="Open in your usual viewer or player"
                aria-label={`Open ${file.name}`}
              >
                {#if canPreview(file)}
                  <img
                    class="file-preview"
                    src={convertFileSrc(file.path)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onerror={() => previewFailed[file.path] = true}
                  />
                {:else if isVideoFile(file.name) && videoPreviews[file.path]}
                  <img class="file-preview" src={videoPreviews[file.path]} alt="" decoding="async" />
                {:else if isVideoFile(file.name) && !videoPreviewFailed[file.path]}
                  <span class="file-preview file-preview-icon" use:lazyVideoPreview={file} title="Loading a frame…">{getIconForFile(file.name)}</span>
                {:else}
                  <span class="file-preview file-preview-icon" title={getFileExt(file.name).toUpperCase()}>{getIconForFile(file.name)}</span>
                {/if}
                {#if isVideoFile(file.name)}<span class="video-badge">▶</span>{/if}
              </button>

              <div class="file-main">
                <div class="file-head">
                  <button class="file-name" type="button" onclick={() => copyFileName(file)} title={`Copy ${file.name}`}>{file.name}</button>
                  <span class="file-details">{formatFileDetails(file)}</span>
                  {#if copiedFilePath === file.path}
                    <span class="copied-badge">Copied</span>
                  {/if}
                </div>
                {#if fileCheckStatus[file.path] === "done" && getFileCategory(file) !== 'repair'}
                  {#if fileExists[file.path]}
                    <TagEditor
                      compact
                      tags={savedTags[file.path] || []}
                      suggestions={tagSuggestions}
                      placeholder="Add tags (saved right away)…"
                      onAdd={(tags) => changeSavedTags(file, { add: tags })}
                      onRemove={(tag) => changeSavedTags(file, { remove: [tag] })}
                      quickCount={focusedRow === file.path ? 8 : 0}
                      disabled={uploadStatus[file.path] === 'removing'}
                    />
                  {:else}
                    <TagEditor
                      compact
                      tags={pendingTags[file.path] || []}
                      suggestions={tagSuggestions}
                      placeholder={batchTags.length ? `More tags (plus: ${batchTags.join(', ')})…` : "Tags for this file…"}
                      onAdd={(tags) => addPendingTags(file, tags)}
                      onRemove={(tag) => removePendingTag(file, tag)}
                      quickCount={focusedRow === file.path ? 8 : 0}
                      disabled={uploadStatus[file.path] === 'uploading'}
                    />
                  {/if}
                {/if}
              </div>

              <div class="file-actions">
                {#if fileCheckStatus[file.path] === "failed"}
                  <span class="badge danger" title="This file could not be checked against the Grail">Check failed</span>
                {:else if fileCheckStatus[file.path] !== "done"}
                  <span class="badge info" title="Computing the hash and checking whether this file is already in the Grail">Checking…</span>
                {:else if fileExists[file.path] && fileRepairNeeded[file.path]}
                  <span class="badge warning" title={`The Grail has this item but is missing: ${(fileMissingParts[file.path] || []).join(', ')}`}>
                    Missing {(fileMissingParts[file.path] || []).join(' + ')}
                  </span>
                  <button onclick={() => handleSingleRepair(file)} class="primary-button small" disabled={isUploading && busy}>
                    {uploadStatus[file.path] === "repairing" ? 'Repairing…' : 'Repair'}
                  </button>
                  <button onclick={() => handleThumbnailRegeneration(file)} class="secondary-button small" title="Make and upload a new cover image" disabled={isUploading && busy}>
                    {uploadStatus[file.path] === "thumbnailing" ? 'Working…' : 'New cover'}
                  </button>
                  <button onclick={() => handleDeleteFromGrail(file)} class="danger-link" title="Delete from the Grail (restorable for 30 days)" disabled={isUploading && busy}>
                    {uploadStatus[file.path] === "purging" ? 'Deleting…' : 'Delete from Grail'}
                  </button>
                {:else if fileExists[file.path]}
                  <span class="badge success" title="This file is already in the Grail, complete">In the Grail</span>
                  <button
                    onclick={() => removeFromPc([file])}
                    class="secondary-button small"
                    title="Move this file to the Recycle Bin. It stays saved in the Grail."
                    disabled={isRemoving || isUploading}
                  >
                    {uploadStatus[file.path] === "removing" ? 'Removing…' : 'Remove from PC'}
                  </button>
                  <button onclick={() => handleThumbnailRegeneration(file)} class="secondary-button small" title="Make and upload a new cover image" disabled={isUploading && busy}>
                    {uploadStatus[file.path] === "thumbnailing" ? 'Working…' : 'New cover'}
                  </button>
                  <button onclick={() => handleDeleteFromGrail(file)} class="danger-link" title="Delete from the Grail (restorable for 30 days)" disabled={isUploading && busy}>
                    {uploadStatus[file.path] === "purging" ? 'Deleting…' : 'Delete from Grail'}
                  </button>
                {:else}
                  <button
                    onclick={() => handleSingleUpload(file)}
                    class="primary-button small"
                    class:failed={uploadStatus[file.path] === "failed"}
                    disabled={isUploading && uploadStatus[file.path] === "uploading"}
                  >
                    {#if uploadStatus[file.path] === "uploading"}
                      Uploading…
                    {:else if uploadStatus[file.path] === "completed"}
                      Uploaded
                    {:else if uploadStatus[file.path] === "failed"}
                      Retry
                    {:else}
                      Upload
                    {/if}
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if selectedPath && (getEligibleFiles().length > 0 || removableFiles.length > 0 || tabCounts.repair > 0)}
      <div class="bottom-actions">
        {#if removableFiles.length > 0}
          <button
            onclick={handleRemoveAllUploaded}
            class="secondary-button"
            disabled={isUploading || isRemoving}
            title="Move every file that is already in the Grail to the Recycle Bin"
          >
            {isRemoving ? 'Removing…' : `Remove ${removableFiles.length} from PC`}
          </button>
        {/if}
        {#if tabCounts.repair > 0}
          <button onclick={handleRepairAll} class="secondary-button" disabled={isUploading || isRemoving} title="Upload the missing parts of every item that needs repair">
            Repair all ({tabCounts.repair})
          </button>
        {/if}
        {#if getEligibleFiles().length > 0}
          <button onclick={handleUploadAll} class="primary-button" disabled={isUploading || isRemoving} title="Upload every new file in this folder">
            Upload all ({getEligibleFiles().length})
          </button>
        {/if}
      </div>
    {/if}
  </div>
</main>

<style>
  /* One font and a small palette: blue for the main action, neutral for the rest, red only
     for deleting from the Grail. */
  :global(:root) {
    --bg: #f3f4f6;
    --surface: #ffffff;
    --surface-muted: #f9fafb;
    --border: #e5e7eb;
    --border-strong: #d1d5db;
    --text: #111827;
    --text-muted: #6b7280;
    --primary: #2563eb;
    --primary-hover: #1d4ed8;
    --primary-soft: #dbeafe;
    --danger: #dc2626;
    --success-bg: #dcfce7;
    --success-text: #166534;
    --warning-bg: #ffedd5;
    --warning-text: #9a3412;
    --danger-bg: #fee2e2;
    --info-bg: #e0f2fe;
    --info-text: #075985;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #18181b;
      --surface: #232326;
      --surface-muted: #1c1c1f;
      --border: #34343a;
      --border-strong: #44444c;
      --text: #f4f4f5;
      --text-muted: #a1a1aa;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --primary-soft: #1e3a5f;
      --danger: #f87171;
      --success-bg: #14321f;
      --success-text: #86efac;
      --warning-bg: #3b2414;
      --warning-text: #fdba74;
      --danger-bg: #3a1f1f;
      --info-bg: #0c2a3d;
      --info-text: #7dd3fc;
    }
  }

  :global(html, body) {
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 14px;
  }

  :global(button, input, select, textarea) {
    font-family: inherit;
  }

  .container {
    margin: 0 auto;
    padding: 0.75rem 1.25rem 1rem;
    max-width: 1280px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }

  .brand-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
    flex: 0 0 auto;
  }

  .brand-logo {
    width: 2rem;
    height: 2rem;
    flex: 0 0 auto;
  }

  .app-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
  }

  .view-switch {
    display: flex;
    gap: 2px;
    margin-left: auto;
    padding: 3px;
    border-radius: 8px;
    background: var(--border);
  }

  .view-switch button {
    padding: 0.3rem 1rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }

  .view-switch button.selected {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .hidden-view {
    display: none !important;
  }

  .file-explorer {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    flex: 1 1 auto;
    min-height: 0;
    padding: 0.9rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }

  /* Buttons */
  .primary-button,
  .secondary-button,
  .icon-button,
  .danger-link {
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .primary-button {
    padding: 0.45rem 1rem;
    border: 1px solid var(--primary);
    background: var(--primary);
    color: white;
  }

  .primary-button:hover:not(:disabled) {
    background: var(--primary-hover);
  }

  .primary-button.failed {
    border-color: var(--danger);
    background: var(--danger);
  }

  .secondary-button {
    padding: 0.45rem 0.9rem;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
  }

  .secondary-button:hover:not(:disabled),
  .icon-button:hover:not(:disabled) {
    background: var(--surface-muted);
    border-color: var(--text-muted);
  }

  .small {
    padding: 0.25rem 0.7rem;
    font-size: 0.82rem;
  }

  .icon-button {
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    font-size: 1rem;
  }

  .danger-link {
    padding: 0.25rem 0.4rem;
    margin-left: 0.6rem;
    border: none;
    background: none;
    color: var(--danger);
    font-size: 0.82rem;
    font-weight: 500;
  }

  .danger-link:hover:not(:disabled) {
    text-decoration: underline;
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* Folder bar */
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .selected-path {
    flex: 1 1 12rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .watch-status {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--text-muted);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .watch-indicator {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--border-strong);
  }

  .watch-status.watching .watch-indicator {
    background: #22c55e;
  }

  .after-upload {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    padding: 3px;
    border-radius: 8px;
    background: var(--border);
    font-size: 0.82rem;
  }

  .after-upload > span {
    padding: 0 0.5rem;
    color: var(--text-muted);
  }

  .after-upload button {
    padding: 0.25rem 0.7rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .after-upload button.selected {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  /* Messages */
  .error-message,
  .notice-message {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.85rem;
    border-radius: 8px;
    font-size: 0.88rem;
  }

  .error-message {
    background: var(--danger-bg);
    color: var(--danger);
  }

  .notice-message {
    background: var(--success-bg);
    color: var(--success-text);
  }

  .error-message p,
  .notice-message p {
    margin: 0;
    flex: 1;
  }

  .close-error,
  .close-notice {
    padding: 0 0.25rem;
    border: none;
    background: none;
    color: inherit;
    font-size: 1.3rem;
    line-height: 1;
    cursor: pointer;
  }

  .scan-status {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  /* Tabs and batch tags */
  .list-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .list-tab {
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .list-tab.selected {
    border-color: var(--primary);
    background: var(--primary);
    color: white;
  }

  .list-tab.alert:not(.selected) {
    border-color: var(--danger);
    color: var(--danger);
  }

  .tab-count {
    margin-left: 0.2rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }

  .batch-tags {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: var(--surface-muted);
    border: 1px solid var(--border);
  }

  .batch-tags :global(.tag-editor) {
    flex: 1;
  }

  .batch-tags-label {
    flex: 0 0 auto;
    padding-top: 0.3rem;
    font-size: 0.85rem;
    font-weight: 600;
  }

  /* Upload in progress */
  .now-uploading {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: var(--primary-soft);
  }

  .now-uploading-preview {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    border-radius: 6px;
    object-fit: cover;
    background: var(--border);
  }

  .now-uploading-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .now-uploading-label {
    color: var(--primary);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .now-uploading-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .now-uploading-progress {
    height: 4px;
    border-radius: 999px;
    background: var(--surface);
    overflow: hidden;
  }

  .now-uploading-progress > div {
    height: 100%;
    background: var(--primary);
    transition: width 0.3s;
  }

  /* File list */
  .file-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .file-list ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .empty-tab {
    margin: 1rem;
    color: var(--text-muted);
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .file-item:last-child {
    border-bottom: none;
  }

  .file-item:focus-within {
    background: var(--surface-muted);
  }

  .file-item.active {
    background: var(--primary-soft);
    box-shadow: inset 3px 0 0 var(--primary);
  }

  .file-item.failed {
    background: var(--danger-bg);
    box-shadow: inset 3px 0 0 var(--danger);
  }

  .preview-button {
    position: relative;
    flex: 0 0 auto;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: none;
    cursor: zoom-in;
  }

  .file-preview {
    display: block;
    width: 72px;
    height: 72px;
    border-radius: 6px;
    object-fit: cover;
    background: var(--border);
  }

  .file-preview-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
  }

  .video-badge {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 0 0.3rem;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.65);
    color: white;
    font-size: 0.6rem;
    line-height: 1.4;
  }

  .file-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .file-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    min-width: 0;
  }

  .file-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.92rem;
    font-weight: 600;
    text-align: left;
    cursor: copy;
  }

  .file-details {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-size: 0.78rem;
  }

  .copied-badge {
    flex: 0 0 auto;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--success-bg);
    color: var(--success-text);
    font-size: 0.72rem;
  }

  .file-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .badge {
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .badge.success {
    background: var(--success-bg);
    color: var(--success-text);
  }

  .badge.warning {
    background: var(--warning-bg);
    color: var(--warning-text);
  }

  .badge.danger {
    background: var(--danger-bg);
    color: var(--danger);
  }

  .badge.info {
    background: var(--info-bg);
    color: var(--info-text);
  }

  .bottom-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex: 0 0 auto;
  }
</style>
