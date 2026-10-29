import { readFileSync } from 'node:fs';
import { getResolution, isValidCell } from 'h3-js';
import { z } from 'zod';

export const rolloutPhases = ['la-pilot', 'la-metro', 'top-metros', 'rest-us'] as const;
export type RolloutPhase = typeof rolloutPhases[number];
export const priorityJobSchema = z.object({
  hexId: z.string().refine(id => isValidCell(id) && getResolution(id) === 7, 'Resolution-7 hex required'),
  priority: z.number().int().min(0).max(2147483647),
}).strict();
export type PriorityJob = z.infer<typeof priorityJobSchema>;
export const priorityBatchSchema = z.object({
  version: z.literal(1), phase: z.enum(rolloutPhases), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  jobs: z.array(priorityJobSchema).min(1).max(1000),
}).strict().refine(batch => new Set(batch.jobs.map(job => job.hexId)).size === batch.jobs.length,
  'Duplicate priority hex').refine(batch => batch.jobs.every((job, i) => i === 0 || job.priority < batch.jobs[i - 1]!.priority),
  'Priorities must strictly descend');

/** Shared by local enqueue and the private cloud client; never interprets a file as shell arguments. */
export function readPriorityBatch(path: string): PriorityJob[] {
  const bytes = readFileSync(path);
  if (bytes.length > 128 * 1024) throw new Error('Priority batch exceeds 128 KiB');
  return priorityBatchSchema.parse(JSON.parse(bytes.toString('utf8'))).jobs;
}
