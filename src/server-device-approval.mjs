import { readFileSync } from 'node:fs';
import { createDeviceApproval } from './device-approval.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));

export const deviceApproval = createDeviceApproval({ config });
