import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appRoot = process.cwd();
const templatePath = path.join(appRoot, 'template.yaml');

const functions = [
  {
    resourceName: 'ProtectedReadFrontendRewriteFunction',
    sourcePath: path.join(appRoot, 'cloudfront', 'protected-read-frontend-rewrite.js')
  }
];

function indentBlock(text, spaces) {
  const prefix = ' '.repeat(spaces);
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function replaceFunctionCode(template, resourceName, source) {
  const newline = template.includes('\r\n') ? '\r\n' : '\n';
  const lines = template.split(/\r?\n/);
  const resourceLine = `  ${resourceName}:`;
  const functionCodeLine = '      FunctionCode: |';
  const resourceIndex = lines.findIndex((line) => line === resourceLine);
  if (resourceIndex === -1) {
    throw new Error(`Could not find resource ${resourceName} in template.yaml`);
  }
  const functionCodeIndex = lines.findIndex(
    (line, index) => index > resourceIndex && line === functionCodeLine
  );
  if (functionCodeIndex === -1) {
    throw new Error(`Could not find FunctionCode block for ${resourceName}`);
  }
  let blockEndIndex = functionCodeIndex + 1;
  while (blockEndIndex < lines.length) {
    const line = lines[blockEndIndex];
    if (line === '' || line.startsWith('        ')) {
      blockEndIndex += 1;
      continue;
    }
    break;
  }
  const replacementLines = indentBlock(source, 8).split('\n');
  lines.splice(functionCodeIndex + 1, blockEndIndex - functionCodeIndex - 1, ...replacementLines);
  return lines.join(newline);
}

async function main() {
  let template = await readFile(templatePath, 'utf8');

  for (const entry of functions) {
    const source = await readFile(entry.sourcePath, 'utf8');
    template = replaceFunctionCode(template, entry.resourceName, source);
  }

  await writeFile(templatePath, template, 'utf8');
  console.log(`Synchronized CloudFront function sources into ${templatePath}`);
}

await main();
