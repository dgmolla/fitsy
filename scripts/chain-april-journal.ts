import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stateHash } from "../apps/api/services/chainPilotPlan";
import type { AprilJournal } from "../apps/api/services/chainPilotRollback";
import { MAX_APRIL_CHUNK } from "../apps/api/services/chainAprilBatch";
export interface AprilStarted { target: string; planHash: string; count: number; chunkSize?: number }
export interface AprilChunk { target: string; planHash: string; start: number; entries: AprilJournal[]; hash: string }
const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
/** A complete durable receipt covers every row committed in an atomic chunk. */
export function readAprilJournals(directory: string, target: string): AprilJournal[] {
  const info = read<AprilStarted>(join(directory, "started.json"));
  if (info.target !== target) throw new Error("Database target differs from the journal");
  const stoppedPath = join(directory, "stopped.json"), stopped = existsSync(stoppedPath) ? read<AprilStarted>(stoppedPath) : undefined;
  if (stopped && (stopped.target !== target || stopped.planHash !== info.planHash || !Number.isSafeInteger(stopped.count) || stopped.count < 0 || stopped.count >= info.count)) throw new Error("Invalid stopped-batch evidence");
  const count = stopped?.count ?? info.count, files = readdirSync(directory);
  if (!Number.isSafeInteger(info.count) || info.count < 1) throw new Error("Invalid April journal count");
  if (info.chunkSize === undefined) {
    const names = files.filter(f => /^\d+\.json$/.test(f)).sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]));
    if (names.length !== count || names.some((name, index) => name !== `${index}.json`)) throw new Error(`Incomplete April rollback evidence: expected ${count} contiguous journals, found ${names.length}; inspect the saved plan before recovery`);
    return names.map(name => read<AprilJournal>(join(directory, name))).reverse();
  }
  const size = info.chunkSize;
  if (!Number.isSafeInteger(size) || size < 2 || size > MAX_APRIL_CHUNK || (stopped && count % size !== 0)) throw new Error("Invalid April chunk size or stopped boundary");
  const names = files.filter(f => /^chunk-\d+\.json$/.test(f));
  if (names.length !== Math.ceil(count / size) || files.some(f => /^\d+\.json$/.test(f))) throw new Error("Incomplete or mixed April chunk evidence; inspect the saved plan before recovery");
  const entries: AprilJournal[] = [];
  for (let start = 0; start < count; start += size) {
    const chunk = read<AprilChunk>(join(directory, `chunk-${start}.json`));
    if (chunk.target !== target || chunk.planHash !== info.planHash || chunk.start !== start || !Array.isArray(chunk.entries)
      || chunk.entries.length !== Math.min(size, count - start) || stateHash({ start, entries: chunk.entries }) !== chunk.hash) throw new Error("Invalid April chunk receipt");
    entries.push(...chunk.entries);
  }
  return entries.reverse();
}
