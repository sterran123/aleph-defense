import { readFileSync } from 'node:fs';
import { createOperationsHandler } from './operations-api.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));

export const operations = createOperationsHandler({ config });
