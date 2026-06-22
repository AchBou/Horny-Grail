import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const binariesDir = path.join(appRoot, "src-tauri", "binaries");
const ffmpegPath = path.join(binariesDir, "ffmpeg.exe");
const ffmpegDownloadUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

if (process.platform !== "win32") {
  console.log("Skipping ffmpeg.exe download on non-Windows platform.");
  process.exit(0);
}

if (await fileExists(ffmpegPath)) {
  console.log(`ffmpeg already present at ${ffmpegPath}`);
  process.exit(0);
}

await mkdir(binariesDir, { recursive: true });

const tempDir = await mkdtemp(path.join(tmpdir(), "hornygrail-ffmpeg-"));
const zipPath = path.join(tempDir, "ffmpeg-release-essentials.zip");
const extractDir = path.join(tempDir, "extract");

try {
  console.log(`Downloading ffmpeg from ${ffmpegDownloadUrl}`);
  await downloadFile(ffmpegDownloadUrl, zipPath);

  console.log("Extracting ffmpeg archive");
  await extractZip(zipPath, extractDir);

  const extractedFfmpegPath = await findFileRecursive(extractDir, "ffmpeg.exe");
  if (!extractedFfmpegPath) {
    throw new Error("ffmpeg.exe was not found in the downloaded archive");
  }

  const tempOutput = `${ffmpegPath}.tmp`;
  await copyFile(extractedFfmpegPath, tempOutput);
  await chmod(tempOutput, 0o755);
  await rename(tempOutput, ffmpegPath);

  console.log(`Saved ffmpeg to ${ffmpegPath}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function fileExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`failed to download ffmpeg archive: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationPath));
}

async function extractZip(zipFilePath, destinationDir) {
  await mkdir(destinationDir, { recursive: true });

  await runCommand("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath '${zipFilePath}' -DestinationPath '${destinationDir}' -Force`
  ]);
}

async function findFileRecursive(rootDir, filename) {
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }

    if (entry.isDirectory()) {
      const nestedPath = await findFileRecursive(fullPath, filename);
      if (nestedPath) {
        return nestedPath;
      }
    }
  }

  return null;
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
