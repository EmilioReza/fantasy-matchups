// First workflow step: decide whether this scheduled run is the 1 AM run, the 5 AM run, or a no-op.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideRun } from '../src/lib/timegate.ts';
import { DATA_DIR } from './paths.ts';

const metaFile = join(DATA_DIR, 'meta.json');
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const r = decideRun(new Date(), {
  lastRunChicagoDate: meta.lastRunChicagoDate ?? null,
  lastSettleChicagoDate: meta.lastSettleChicagoDate ?? null,
}, manual);
console.log(`Chicago ${r.chicagoDate} hour ${r.hour}: ${r.kind}`);
const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, `run=${r.kind !== 'skip'}\nkind=${r.kind}\nchicago_date=${r.chicagoDate}\n`);
