import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSamconfigValue(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match?.[1] || '';
}

/** Reads stack_name and region from the local samconfig.toml, if present. */
export function readSamconfig() {
  try {
    const text = readFileSync(resolve(appRoot, 'samconfig.toml'), 'utf8');
    return {
      stackName: readSamconfigValue(text, 'stack_name'),
      region: readSamconfigValue(text, 'region')
    };
  } catch {
    return { stackName: '', region: '' };
  }
}

export function parseArgs(argv) {
  const args = { flags: new Set(), values: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const [name, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      args.values[name] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args.values[name] = argv[index + 1];
      index += 1;
    } else {
      args.flags.add(name);
    }
  }
  return args;
}

export function resolveRegion(args) {
  return args.values.region || process.env.AWS_REGION || readSamconfig().region || undefined;
}

/** Looks up a deployed stack's parameters and outputs. */
export async function describeStack(args) {
  const stackName = args.values.stack || readSamconfig().stackName;
  if (!stackName) {
    throw new Error('Could not find the stack name. Pass --stack <name> or set stack_name in samconfig.toml.');
  }

  const client = new CloudFormationClient({ region: resolveRegion(args) });
  const result = await client.send(new DescribeStacksCommand({ StackName: stackName }));
  const stack = result.Stacks?.[0];
  if (!stack) {
    throw new Error(`Stack ${stackName} not found`);
  }

  const parameters = Object.fromEntries((stack.Parameters || []).map((p) => [p.ParameterKey, p.ParameterValue]));
  const outputs = Object.fromEntries((stack.Outputs || []).map((o) => [o.OutputKey, o.OutputValue]));
  return { stackName, parameters, outputs };
}
