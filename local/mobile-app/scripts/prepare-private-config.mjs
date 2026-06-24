import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appRoot = process.cwd();
const sourcePath = path.join(appRoot, 'mobile.private.json');
const outputDir = path.join(appRoot, 'src', 'lib', 'generated');
const outputPath = path.join(outputDir, 'privateConfig.js');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function validateConfig(config) {
  const apiBaseUrl = config?.apiBaseUrl;
  const cloudFrontBaseUrl = config?.cloudFrontBaseUrl;
  const writeApiKey = config?.writeApiKey;

  if (typeof apiBaseUrl !== 'string' || !apiBaseUrl.startsWith('http') || !apiBaseUrl.endsWith('/api')) {
    fail('mobile.private.json must contain apiBaseUrl ending with /api');
  }

  if (typeof cloudFrontBaseUrl !== 'string' || !cloudFrontBaseUrl.startsWith('http') || cloudFrontBaseUrl.endsWith('/')) {
    fail('mobile.private.json must contain cloudFrontBaseUrl without a trailing slash');
  }

  if (typeof writeApiKey !== 'string' || writeApiKey.length === 0) {
    fail('mobile.private.json must contain a non-empty writeApiKey');
  }

  return { apiBaseUrl, cloudFrontBaseUrl, writeApiKey };
}

async function main() {
  let parsed;

  try {
    parsed = JSON.parse(await readFile(sourcePath, 'utf8'));
  } catch (error) {
    fail(`Failed to read ${sourcePath}. Create it from mobile.private.example.json before building. ${error instanceof Error ? error.message : String(error)}`);
  }

  const config = validateConfig(parsed);
  const fileContents = `export const mobilePrivateConfig = ${JSON.stringify(config, null, 2)};\n`;

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, fileContents, 'utf8');
  console.log(`Prepared private mobile config at ${outputPath}`);
}

await main();
