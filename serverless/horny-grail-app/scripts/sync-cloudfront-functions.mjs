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
  const resourceMarker = `${resourceName}:`;
  const resourceIndex = template.indexOf(resourceMarker);
  if (resourceIndex === -1) {
    throw new Error(`Could not find resource ${resourceName} in template.yaml`);
  }

  const functionCodeMarker = '      FunctionCode: |\n';
  const functionCodeIndex = template.indexOf(functionCodeMarker, resourceIndex);
  if (functionCodeIndex === -1) {
    throw new Error(`Could not find FunctionCode block for ${resourceName}`);
  }

  const blockStart = functionCodeIndex + functionCodeMarker.length;
  let blockEnd = template.indexOf('\n  ', blockStart);
  if (blockEnd === -1) {
    blockEnd = template.length;
  }

  const replacement = `${functionCodeMarker}${indentBlock(source, 8)}\n`;
  return `${template.slice(0, functionCodeIndex)}${replacement}${template.slice(blockEnd)}`;
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
