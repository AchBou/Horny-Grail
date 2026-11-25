import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

// sam build does not validate IAM policy structure; a mis-indented statement only fails
// at deploy time ("Syntax errors in policy") and rolls the whole stack back.
const CFN_TAGS = ['Ref', 'Sub', 'GetAtt', 'If', 'Equals', 'Not', 'Join', 'Select', 'Split', 'FindInMap',
  'ImportValue', 'GetAZs', 'And', 'Or', 'Condition', 'Base64', 'Cidr'];
const types = CFN_TAGS.flatMap((tag) => ['scalar', 'sequence', 'mapping'].map((kind) =>
  new yaml.Type(`!${tag}`, { kind, construct: (data) => ({ [`Fn::${tag}`]: data }) })));
const template = yaml.load(readFileSync(new URL('../../template.yaml', import.meta.url), 'utf8'), {
  schema: yaml.Schema.create(yaml.DEFAULT_SAFE_SCHEMA, types)
});
const functions = Object.entries(template.Resources).filter(([, r]) => r.Type === 'AWS::Serverless::Function');

describe('template.yaml function policies', () => {
  it.each(functions)('%s has well-formed policies', (_name, resource) => {
    for (const policy of resource.Properties.Policies || []) {
      expect(Object.keys(policy)).toHaveLength(1);
      for (const statement of policy.Statement || []) {
        expect(Object.keys(statement).sort()).toEqual(['Action', 'Effect', 'Resource']);
      }
    }
  });

  it.each(functions)('%s reads secrets at runtime, not from env', (_name, resource) => {
    const env = JSON.stringify(resource.Properties.Environment?.Variables || {});
    expect(env).not.toContain('resolve:secretsmanager');
    expect(JSON.stringify(resource.Properties.Policies || [])).toContain('AppSecretsSecretArn');
  });
});
