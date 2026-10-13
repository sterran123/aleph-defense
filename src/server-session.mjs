import { readFileSync } from 'node:fs';
import { createSessionAuth } from './auth-session.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const authConfig = JSON.parse(readFileSync(new URL('../config/auth.json', import.meta.url), 'utf8'));

export const sessionAuth = createSessionAuth({ config, authConfig });
