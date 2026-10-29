// Substitute only provider HTTP; the service, queue, limiter and PostgreSQL execute unchanged.
require('../test-fixtures/pipeline-v2-runtime.cjs');
const fs = require('node:fs');
const provider = global.fetch;
global.fetch = async (url, options) => {
  const pause = process.env.CLOUD_TEST_PAUSE;
  if ((pause === 'ue' && String(url).includes('getStoreV1')) || (pause === 'jev' && String(url) === 'https://api.typesafe.ai/v1/systemone')) {
    fs.appendFileSync(process.env.V2_TEST_EVENTS, JSON.stringify({ type: 'paused', provider: pause }) + '\n');
    if (pause === 'jev') fs.appendFileSync(process.env.V2_TEST_EVENTS, JSON.stringify({ type: 'jev_call' }) + '\n');
    return new Promise((_, reject) => {
      const abort = () => reject(new DOMException('Fixture request cancelled', 'AbortError'));
      if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
    });
  }
  return provider(url, options);
};
