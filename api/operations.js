import { createOperationsHandler } from '../src/operations-api.mjs';
import config from '../aleph.config.json' with { type: 'json' };

const operations = createOperationsHandler({ config });

export default async function handler(request, response) {
  return operations(request, response);
}
