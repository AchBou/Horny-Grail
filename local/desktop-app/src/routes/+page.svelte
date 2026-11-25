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
  import { purgeAssetMetadata } from "$lib/functions/purgeAssetMetadata.js";
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
  let uploadedFiles = $state<string[]>([]);
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
          const exists = Boolean(integrity?.metadataExists);
          if (generation !== scanGeneration) return;

          fileHashes[f.path] = hex;
          fileExists[f.path] = exists;
          fileCheckStatus[f.path] = 'done';
          fileRepairNeeded[f.path] = Boolean(exists && integrity?.repairRequired);
          fileMissingParts[f.path] = Array.isArray(integrity?.missing) ? integrity.missing : [];
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
        console.log("File system event:", event);
        
        try {
          // Update last change timestamp
          lastChangeDetected = new Date();
          
          // Determine what kind of event occurred for better error handling
          let eventType = "change";
          if (typeof event.type !== 'string' && 'create' in event.type) {
            eventType = "create";
          } else if (typeof event.type !== 'string' && 'remove' in event.type) {
            eventType = "remove";
          } else if (typeof event.type !== 'string' && 'modify' in event.type) {
            eventType = "modify";
          }
          
          console.log(`Detected ${eventType} event for:`, event.paths);
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
              console.log(`Processed ${pendingUpdates} file system events`);
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
      console.log("File watcher set up for:", normalizedPath);
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

  async function navigateToDirectory(file: FileEntry): Promise<void> {
    if (file.isDirectory) {
      // Unwatch previous folder
      if (unwatchFn) {
        unwatchFn();
        unwatchFn = null;
      }
      
      // Reset watching state
      isWatching = false;
      lastChangeDetected = null;
      
      await loadFiles(file.path);
      
      // Set up new watcher for the navigated directory
      setupFileWatcher(file.path);
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
      await registerUploadedFile(fileHash, fileExt);
      fileExists[file.path] = true;
      fileRepairNeeded[file.path] = false;
      fileMissingParts[file.path] = [];

      // Update status
      uploadStatus[file.path] = "completed";
      uploadedFiles = [...uploadedFiles, file.path];
      
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
    if (file.isDirectory) {
      await navigateToDirectory(file);
      return;
    }

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

  async function handleAssetPurge(file: FileEntry): Promise<void> {
    if (file.isDirectory || !isMediaFile(file.name)) {
      return;
    }

    const confirmed = window.confirm(
      `Delete the DynamoDB metadata entry for ${file.name}? This leaves the local file and uploaded S3 objects untouched.`
    );
    if (!confirmed) {
      return;
    }

    try {
      uploadStatus[file.path] = "purging";
      isUploading = true;

      const fileHash = fileHashes[file.path] || await computeFileHash(file.path);
      await purgeAssetMetadata(fileHash);

      fileHashes[file.path] = fileHash;
      fileExists[file.path] = false;
      fileCheckStatus[file.path] = "done";
      fileRepairNeeded[file.path] = false;
      fileMissingParts[file.path] = [];
      uploadStatus[file.path] = "completed";
      errorMessage = "";
    } catch (error) {
      console.error("Error purging asset metadata:", error);
      uploadStatus[file.path] = "failed";
      errorMessage = `Failed to purge ${file.name}: ${getErrorDetail(error)}`;
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
      if (activeTab !== 'all') activeTab = 'new';
      const eligible = [...getEligibleFiles()].sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
      for (const [index, f] of eligible.entries()) {
        currentUpload = { path: f.path, name: f.name, index: index + 1, total: eligible.length };
        await handleFileUpload(f);
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
    } finally {
      if (currentUpload?.path === file.path) currentUpload = null;
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
    <h1 class="app-title">The Horny Grail Uploader</h1>
  </div>

  <div class="file-explorer">
    <div class="controls">
      <div class="control-buttons">
        <button onclick={selectFolder} class="sync-button" title="Choose a folder to watch and upload">🔄 Sync Folder</button>
        {#if selectedPath}
          <button
            onclick={recheckExistingFiles}
            class="recheck-button"
            disabled={isScanningMetadata || isLoading}
            title="Re-run the duplicate check for the files in this folder"
          >
            Recheck Existing Files
          </button>
        {/if}
      </div>
      {#if selectedPath}
        <p class="selected-path">Sync folder: {selectedPath}</p>
        {#if isWatching}
          <p class="watch-status watching">
            <span class="watch-indicator"></span> Watching for changes
            {#if lastChangeDetected}
              <span class="last-change">
                (Last change: {lastChangeDetected.toLocaleTimeString()})
                {#if pendingUpdates > 0}
                  <span class="pending-updates">{pendingUpdates} updates pending...</span>
                {/if}
              </span>
            {/if}
          </p>
        {:else}
          <p class="watch-status">Not watching</p>
        {/if}
      {/if}
    </div>

    {#if errorMessage}
      <div class="error-message">
        <p>⚠️ {errorMessage}</p>
        <button class="close-error" onclick={() => errorMessage = ""}>×</button>
      </div>
    {/if}

    {#if isScanningMetadata}
      <p class="scan-status">Checking existing files... {scannedMetadataCount}/{totalMetadataCount}</p>
    {/if}

    {#if files.length > 0}
      <div class="list-tabs" role="tablist" aria-label="Filter files">
        {#each LIST_TABS as tab (tab.id)}
          <button
            role="tab"
            aria-selected={activeTab === tab.id}
            class="list-tab"
            class:selected={activeTab === tab.id}
            class:alert={tab.id === 'failed' && tabCounts.failed > 0}
            onclick={() => activeTab = tab.id}
          >
            {tab.label} <span class="tab-count">{tabCounts[tab.id]}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if currentUpload}
      <div class="now-uploading" aria-live="polite">
        {#if canPreview(currentUpload)}
          <img class="now-uploading-preview" src={convertFileSrc(currentUpload.path)} alt="" decoding="async" />
        {:else}
          <span class="now-uploading-preview file-preview-icon">{getIconForFile(currentUpload.name)}</span>
        {/if}
        <div class="now-uploading-text">
          <span class="now-uploading-label">
            Uploading {currentUpload.total > 1 ? `${currentUpload.index} of ${currentUpload.total}` : ''}
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
        <p>Loading files...</p>
      {:else if files.length === 0}
        <p>No files found. Select a folder to view its contents.</p>
      {:else if visibleFiles.length === 0}
        <p class="empty-tab">
          {LIST_TABS.find((tab) => tab.id === activeTab)?.empty}
          {#if activeTab === 'new' && isScanningMetadata}Still checking the rest of the folder...{/if}
        </p>
      {:else}
        <ul>
          {#each visibleFiles as file (file.path)}
            <li
              class="file-item"
              class:active={currentUpload?.path === file.path}
              class:failed={getFileCategory(file) === 'failed'}
              data-path={file.path}
            >
              <button
                onclick={() => copyFileName(file)}
                class="file-button"
                title={file.isDirectory ? `Open ${file.name}` : `Copy ${file.name}`}
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
                {:else}
                  <span class="file-preview file-preview-icon" title={getFileExt(file.name).toUpperCase()}>{getIconForFile(file.name)}</span>
                {/if}
                <span class="file-text">
                  <span class="file-name" title={file.name}>{file.name}</span>
                  <span class="file-details">{formatFileDetails(file)}</span>
                </span>
                {#if copiedFilePath === file.path}
                  <span class="copied-badge">Copied</span>
                {/if}
              </button>
              
              {#if !file.isDirectory}
                {#if fileCheckStatus[file.path] === "failed"}
                  <span class="repair-badge" title="This file could not be checked against the backend">Check failed</span>
                {:else if fileCheckStatus[file.path] !== "done"}
                  <span class="checking-badge" title="Computing hash and checking whether this file already exists">Checking...</span>
                {:else if fileExists[file.path] && fileRepairNeeded[file.path]}
                  <div class="repair-actions">
                    <span class="repair-badge" title={`Metadata exists but this asset is missing: ${(fileMissingParts[file.path] || []).join(', ')}`}>
                      Missing {(fileMissingParts[file.path] || []).join(' + ')}
                    </span>
                    <button
                      onclick={() => handleFileRepair(file)}
                      class="repair-button"
                      disabled={isUploading && (uploadStatus[file.path] === "uploading" || uploadStatus[file.path] === "repairing" || uploadStatus[file.path] === "thumbnailing")}
                    >
                      {#if uploadStatus[file.path] === "repairing"}
                        Repairing...
                      {:else}
                        Repair
                      {/if}
                    </button>
                    <button
                      onclick={() => handleAssetPurge(file)}
                      class="purge-button"
                      title="Delete metadata entry from DynamoDB"
                      disabled={isUploading && (uploadStatus[file.path] === "uploading" || uploadStatus[file.path] === "repairing" || uploadStatus[file.path] === "thumbnailing" || uploadStatus[file.path] === "purging")}
                    >
                      {#if uploadStatus[file.path] === "purging"}
                        Purging...
                      {:else}
                        Purge
                      {/if}
                    </button>
                    <button
                      onclick={() => handleThumbnailRegeneration(file)}
                      class="thumbnail-button"
                      title="Regenerate thumbnail"
                      aria-label={`Regenerate thumbnail for ${file.name}`}
                      disabled={isUploading && (uploadStatus[file.path] === "uploading" || uploadStatus[file.path] === "repairing" || uploadStatus[file.path] === "thumbnailing")}
                    >
                      {#if uploadStatus[file.path] === "thumbnailing"}
                        ...
                      {:else}
                        ↻
                      {/if}
                    </button>
                  </div>
                {:else if fileExists[file.path]}
                  <div class="repair-actions">
                    <span class="exists-badge" title="This file's hash already exists in the database and its stored assets look complete">Already exists</span>
                    <button
                      onclick={() => handleAssetPurge(file)}
                      class="purge-button"
                      title="Delete metadata entry from DynamoDB"
                      disabled={isUploading && (uploadStatus[file.path] === "uploading" || uploadStatus[file.path] === "repairing" || uploadStatus[file.path] === "thumbnailing" || uploadStatus[file.path] === "purging")}
                    >
                      {#if uploadStatus[file.path] === "purging"}
                        Purging...
                      {:else}
                        Purge
                      {/if}
                    </button>
                    <button
                      onclick={() => handleThumbnailRegeneration(file)}
                      class="thumbnail-button"
                      title="Regenerate thumbnail"
                      aria-label={`Regenerate thumbnail for ${file.name}`}
                      disabled={isUploading && (uploadStatus[file.path] === "uploading" || uploadStatus[file.path] === "repairing" || uploadStatus[file.path] === "thumbnailing")}
                    >
                      {#if uploadStatus[file.path] === "thumbnailing"}
                        ...
                      {:else}
                        ↻
                      {/if}
                    </button>
                  </div>
                {:else}
                  <button
                    onclick={() => handleSingleUpload(file)}
                    class="upload-button"
                    disabled={isUploading && uploadStatus[file.path] === "uploading"}
                  >
                    {#if uploadStatus[file.path] === "uploading"}
                      Uploading...
                    {:else if uploadStatus[file.path] === "completed"}
                      ✓ Uploaded
                    {:else if uploadStatus[file.path] === "failed"}
                      ❌ Failed
                    {:else}
                      Upload
                    {/if}
                  </button>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if selectedPath && getEligibleFiles().length > 0}
      <div class="bottom-actions">
        <button onclick={handleUploadAll} class="upload-all-button" disabled={isUploading} title="Upload all new images in this folder">
          ⬆️ Upload All ({getEligibleFiles().length})
        </button>
      </div>
    {/if}
  </div>
</main>

<style>
  :global(html, body) {
    height: 100%;
    margin: 0;
    overflow: hidden;
  }

  .container {
    margin: 0 auto;
    padding: 0.9rem 1.25rem 1rem;
    max-width: 1200px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }

  h1 {
    text-align: center;
    margin-bottom: 0;
  }

  .brand-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
    flex: 0 0 auto;
  }

  .brand-logo {
    width: 2.25rem;
    height: 2.25rem;
    flex: 0 0 auto;
    filter: drop-shadow(0 3px 6px rgba(59, 130, 246, 0.18));
  }
  
  .app-title {
    font-size: 1.35rem;
    font-weight: bold;
    color: #3b82f6;
    margin: 0;
    letter-spacing: 0.5px;
    position: relative;
  }
  
  .app-title::after {
    display: none;
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100px;
    height: 3px;
    background: linear-gradient(90deg, transparent, #3b82f6, transparent);
  }

  @media (max-width: 720px) {
    .app-title {
      font-size: 1.15rem;
    }
  }

  .file-explorer {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem;
    background-color: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    flex: 1 1 auto;
    min-height: 0; /* allow inner flex children to shrink */
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .control-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .sync-button,
  .recheck-button {
    padding: 0.4em 0.9em;
    font-size: 0.9rem;
  }

  .sync-button {
    min-width: 0;
  }

  .recheck-button {
    min-width: 0;
    background-color: #0f766e;
  }

  .recheck-button:hover:not(:disabled) {
    background-color: #0d5f59;
  }

  .selected-path {
    flex: 1 1 12rem;
    min-width: 0;
    margin: 0;
    font-size: 0.8rem;
    color: #666;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background-color: #f5f5f5;
    padding: 0.35rem 0.7rem;
    border-radius: 6px;
    border: 1px solid #e0e0e0;
    text-align: left;
  }
  
  .watch-status {
    margin: 0;
    font-size: 0.8rem;
    color: #666;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  
  .watch-status.watching {
    color: #2563eb;
  }
  
  .watch-indicator {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #2563eb;
    animation: pulse 1.5s infinite;
  }
  
  .last-change {
    font-size: 0.8rem;
    color: #666;
    margin-left: 0.5rem;
  }
  
  .pending-updates {
    font-weight: bold;
    color: #f59e0b;
    margin-left: 0.5rem;
    animation: pulse-text 1s infinite;
  }
  
  @keyframes pulse-text {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
    100% {
      opacity: 1;
    }
  }
  
  @keyframes pulse {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(1.2);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .error-message {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background-color: #fff3f3;
    border: 1px solid #ffcdd2;
    border-radius: 4px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    color: #d32f2f;
  }

  .error-message p {
    margin: 0;
    flex: 1;
  }

  .scan-status {
    margin: -0.25rem 0 0;
    font-size: 0.85rem;
    color: #666;
    text-align: center;
  }

  .close-error {
    background: none;
    border: none;
    color: #d32f2f;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    margin-left: 0.5rem;
    line-height: 1;
  }

  .file-list {
    border: 1px solid #eee;
    border-radius: 4px;
    padding: 1rem;
    overflow-y: auto;
    background-color: #f9f9f9;
    flex: 1 1 auto;
    min-height: 0;
  }

  .file-list ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .file-list li {
    margin-bottom: 0.25rem;
  }
  
  .file-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .file-button {
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 0.5rem;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    color: inherit;
    font-size: inherit;
    box-shadow: none;
  }

  .file-preview {
    flex: 0 0 auto;
    width: 48px;
    height: 48px;
    border-radius: 6px;
    object-fit: cover;
    background-color: #e5e7eb;
  }

  .file-preview-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
  }

  .file-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .file-details {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .file-item.active {
    background-color: #dbeafe;
    box-shadow: inset 3px 0 0 #3b82f6;
    border-radius: 6px;
  }

  .file-item.failed {
    background-color: #fee2e2;
    box-shadow: inset 3px 0 0 #dc2626;
    border-radius: 6px;
  }

  .list-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }

  .list-tab {
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    border-radius: 9999px;
    border: 1px solid #d1d5db;
    background-color: transparent;
    color: inherit;
    box-shadow: none;
    cursor: pointer;
  }

  .list-tab.selected {
    background-color: #3b82f6;
    border-color: #3b82f6;
    color: white;
  }

  .list-tab.alert:not(.selected) {
    border-color: #dc2626;
    color: #dc2626;
  }

  .tab-count {
    margin-left: 0.25rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }

  .empty-tab {
    color: #6b7280;
  }

  .now-uploading {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.75rem;
    margin-bottom: 0.6rem;
    border: 1px solid #93c5fd;
    border-radius: 8px;
    background-color: #eff6ff;
  }

  .now-uploading-preview {
    flex: 0 0 auto;
    width: 56px;
    height: 56px;
    border-radius: 6px;
    object-fit: cover;
    background-color: #e5e7eb;
  }

  .now-uploading-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .now-uploading-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #2563eb;
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
    border-radius: 9999px;
    background-color: #bfdbfe;
    overflow: hidden;
  }

  .now-uploading-progress > div {
    height: 100%;
    background-color: #2563eb;
    transition: width 0.3s;
  }

  .file-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copied-badge {
    flex: 0 0 auto;
    padding: 0.15rem 0.45rem;
    font-size: 0.72rem;
    color: #065f46;
    background-color: #d1fae5;
    border: 1px solid #34d399;
    border-radius: 9999px;
    white-space: nowrap;
  }
  
  .upload-button {
    padding: 0.3rem 0.6rem;
    font-size: 0.8rem;
    min-width: 80px;
    text-align: center;
    background-color: #4caf50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .upload-button:hover:not(:disabled) {
    background-color: #45a049;
  }
  
  .upload-button:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
    opacity: 0.7;
  }

  .exists-badge {
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    color: #1f2937;
    background-color: #fde68a;
    border: 1px solid #f59e0b;
    border-radius: 9999px;
    white-space: nowrap;
  }

  .repair-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .repair-badge {
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    color: #7c2d12;
    background-color: #fed7aa;
    border: 1px solid #fb923c;
    border-radius: 9999px;
    white-space: nowrap;
  }

  .repair-button {
    padding: 0.3rem 0.6rem;
    font-size: 0.8rem;
    min-width: 80px;
    text-align: center;
    background-color: #ea580c;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .repair-button:hover:not(:disabled) {
    background-color: #c2410c;
  }

  .purge-button {
    padding: 0.3rem 0.6rem;
    font-size: 0.8rem;
    min-width: 80px;
    text-align: center;
    background-color: #b91c1c;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .purge-button:hover:not(:disabled) {
    background-color: #991b1b;
  }

  .thumbnail-button {
    width: 2rem;
    height: 2rem;
    padding: 0;
    font-size: 1rem;
    line-height: 1;
    text-align: center;
    background-color: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
    flex: 0 0 auto;
  }

  .thumbnail-button:hover:not(:disabled) {
    background-color: #1d4ed8;
  }

  .checking-badge {
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    color: #1f2937;
    background-color: #dbeafe;
    border: 1px solid #60a5fa;
    border-radius: 9999px;
    white-space: nowrap;
  }

  .file-button:hover {
    background-color: #eee;
  }

  button {
    border-radius: 8px;
    border: 1px solid #ddd;
    padding: 0.6em 1.2em;
    font-size: 1em;
    font-weight: 500;
    background-color: #3b82f6;
    color: white;
    cursor: pointer;
  }

  button:hover {
    background-color: #2563eb;
  }

  .upload-all-button {
    margin-left: 0.5rem;
    min-width: 130px;
  }

  .upload-all-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .bottom-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.75rem;
    margin-top: 0.5rem;
    border-top: 1px solid #eee;
    background-color: #fff;
    flex: 0 0 auto;
  }

  .upload-all-button {
    font-weight: 600;
  }

  @media (prefers-color-scheme: dark) {
    .file-explorer {
      background-color: #333;
      border-color: #444;
    }

    .file-list {
      background-color: #2a2a2a;
      border-color: #444;
    }

    .file-button:hover {
      background-color: #444;
    }

    .error-message {
      background-color: #3a2222;
      border-color: #5c2626;
      color: #ff6b6b;
    }

    .close-error {
      color: #ff6b6b;
    }

    .selected-path {
      color: #aaa;
      background-color: #2a2a2a;
      border-color: #444;
    }
    
    .watch-status {
      color: #888;
    }

    .scan-status {
      color: #aaa;
    }
    
    .watch-status.watching {
      color: #60a5fa;
    }
    
    .watch-indicator {
      background-color: #60a5fa;
    }
    
    .last-change {
      color: #888;
    }
    
    .pending-updates {
      color: #fbbf24;
    }

    button {
      background-color: #3b82f6;
      color: white;
      border-color: #555;
    }

    button:hover {
      background-color: #2563eb;
    }
    
    .app-title {
      color: #60a5fa;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
    }
    
    .app-title::after {
      background: linear-gradient(90deg, transparent, #60a5fa, transparent);
    }
    
    .bottom-actions {
      border-top-color: #444;
      background-color: #333;
    }

    .file-preview,
    .now-uploading-preview {
      background-color: #3f3f46;
    }

    .file-details,
    .empty-tab {
      color: #9ca3af;
    }

    .file-item.active {
      background-color: #1e3a5f;
    }

    .file-item.failed {
      background-color: #3a2222;
    }

    .list-tab {
      background-color: transparent;
      border-color: #555;
    }

    .list-tab.selected {
      background-color: #3b82f6;
      border-color: #3b82f6;
    }

    .now-uploading {
      background-color: #1e293b;
      border-color: #1d4ed8;
    }

    .now-uploading-label {
      color: #60a5fa;
    }

    .now-uploading-progress {
      background-color: #1e3a5f;
    }
  }
</style>
