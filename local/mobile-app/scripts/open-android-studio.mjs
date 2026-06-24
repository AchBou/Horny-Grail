import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const appRoot = process.cwd();
const androidProjectPath = path.join(appRoot, 'android');
const androidStudioPath = process.env.CAPACITOR_ANDROID_STUDIO_PATH
  || 'C:\\Users\\super\\AppData\\Local\\Programs\\Android Studio\\bin\\studio64.exe';

if (!existsSync(androidStudioPath)) {
  console.error(`Android Studio was not found at ${androidStudioPath}`);
  console.error('Set CAPACITOR_ANDROID_STUDIO_PATH to the full studio64.exe path and retry.');
  process.exit(1);
}

if (!existsSync(androidProjectPath)) {
  console.error(`Android project was not found at ${androidProjectPath}`);
  console.error('Run npm run cap:sync first.');
  process.exit(1);
}

const child = spawn(androidStudioPath, [androidProjectPath], {
  detached: true,
  stdio: 'ignore'
});

child.unref();
console.log(`Opening Android Studio at ${androidProjectPath}`);
