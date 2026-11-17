import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RAW_DIR = process.env.RAW_DIR ?? join(ROOT, '.raw'); // never committed
export const DATA_DIR = join(ROOT, 'public', 'data');
export const WEEKS_DIR = join(DATA_DIR, 'weeks');
export const ensureDir = (d: string) => mkdirSync(d, { recursive: true });
