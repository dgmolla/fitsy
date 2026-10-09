// Retain raw events and count test cases rather than Node's empty-file wrapper.
import { resolve } from 'node:path';
export default async function* reporter(events) {
  let passing = 0;
  for await (const event of events) {
    const data = event.data;
    if (event.type === 'test:pass' && data.details?.type !== 'suite' && !data.skip && !data.todo &&
        (!data.file || resolve(data.name) !== resolve(data.file))) passing++;
    yield JSON.stringify(event) + '\n';
  }
  yield JSON.stringify({ passing_tests: passing }) + '\n';
}
