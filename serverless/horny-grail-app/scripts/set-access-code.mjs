#!/usr/bin/env node
// Sets the passphrase for the web and mobile access screens.
//
//   npm run set-access-code                      prompt, hash, store in the app secret
//   npm run set-access-code -- --print-only      prompt and print the hash, store nothing
//   npm run set-access-code -- --remove-plaintext  also delete the legacy readAccessCode field
//   Options: --secret-id <arn>  --stack <name>  --region <region>
//
// The passphrase never leaves this machine; only its scrypt hash is stored.
import readline from 'node:readline';
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient
} from '@aws-sdk/client-secrets-manager';
import { hashPassphrase, normalizePassphrase } from '../src/lib/passphrase-hash.mjs';
import { describeStack, parseArgs, resolveRegion } from './lib/stack-config.mjs';

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Run this in an interactive terminal so the passphrase can be typed hidden.'));
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) {
        rl.output.write(text);
      }
    };
    rl.question(question, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

function promptVisible(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function readPassphrase() {
  const first = await promptHidden('New passphrase: ');
  const second = await promptHidden('Repeat passphrase: ');

  const normalized = normalizePassphrase(first);
  if (!normalized) {
    throw new Error('Passphrase is empty.');
  }
  if (normalized !== normalizePassphrase(second)) {
    throw new Error('The two entries do not match.');
  }

  const words = normalized.split(' ').length;
  if (words < 4 && normalized.length < 16) {
    console.warn('\nThis passphrase looks short. Four or more random words are recommended,');
    console.warn('e.g. "velvet lantern orbit pickle".');
    const answer = await promptVisible('Use it anyway? (y/N) ');
    if (answer !== 'y' && answer !== 'yes') {
      throw new Error('Cancelled.');
    }
  }

  console.log('Note: case, extra spaces and leading/trailing spaces are ignored when you type it.');
  return first;
}

async function resolveSecretId(args) {
  if (args.values['secret-id']) {
    return args.values['secret-id'];
  }

  const { stackName, parameters } = await describeStack(args);
  const secretId = parameters.AppSecretsSecretArn;
  if (!secretId) {
    throw new Error(`Stack ${stackName} has no AppSecretsSecretArn parameter. Pass --secret-id <arn>.`);
  }
  return secretId;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const passphrase = await readPassphrase();
  const hash = await hashPassphrase(passphrase);

  if (args.flags.has('print-only')) {
    console.log(`\nreadAccessCodeHash:\n${hash}`);
    return;
  }

  const secretId = await resolveSecretId(args);
  const client = new SecretsManagerClient({ region: resolveRegion(args) });
  const current = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const secret = JSON.parse(current.SecretString || '{}');

  secret.readAccessCodeHash = hash;
  if (args.flags.has('remove-plaintext')) {
    delete secret.readAccessCode;
  }

  await client.send(new PutSecretValueCommand({
    SecretId: secretId,
    SecretString: JSON.stringify(secret)
  }));

  console.log('\nPassphrase updated. It takes effect within 5 minutes; no deploy needed.');
  if (args.flags.has('remove-plaintext')) {
    console.log('The old plaintext readAccessCode field was removed.');
  } else if (typeof secret.readAccessCode === 'string') {
    console.log('The old plaintext readAccessCode is no longer used. Remove it with --remove-plaintext when ready.');
  }
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
});
