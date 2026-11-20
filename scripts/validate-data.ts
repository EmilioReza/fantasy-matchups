// Validate every generated data file against its JSON Schema. Exit non-zero on any failure.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ROOT, WEEKS_DIR } from './paths.ts';

export function validateAll(): string[] {
  const ajv = new (Ajv2020 as any)({ allErrors: true });
  (addFormats as any)(ajv);
  const schema = (n: string) => ajv.compile(JSON.parse(readFileSync(join(ROOT, 'schemas', `${n}.schema.json`), 'utf8')));
  const checks: [string, string][] = [
    ['meta', join(DATA_DIR, 'meta.json')],
    ['teams', join(DATA_DIR, 'teams.json')],
    ['players', join(DATA_DIR, 'players.json')],
    ['players', join(DATA_DIR, 'freeagents.json')],
    ['schedule', join(DATA_DIR, 'schedule.json')],
    ...readdirSync(WEEKS_DIR).map((f) => ['week', join(WEEKS_DIR, f)] as [string, string]),
  ];
  const errors: string[] = [];
  const compiled = new Map<string, any>();
  for (const [name, file] of checks) {
    if (!compiled.has(name)) compiled.set(name, schema(name));
    const v = compiled.get(name);
    if (!v(JSON.parse(readFileSync(file, 'utf8')))) {
      errors.push(`${file.replace(ROOT + '/', '')}: ${ajv.errorsText(v.errors, { separator: '; ' })}`);
    }
    if (name === 'week' && statSync(file).size > 300_000) errors.push(`${file}: larger than 300 KB`);
  }
  return errors;
}

if (process.argv[1]?.endsWith('validate-data.ts')) {
  const errors = validateAll();
  for (const e of errors) console.error(e);
  if (errors.length) process.exit(1);
  console.log('all data files valid');
}
