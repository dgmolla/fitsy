/**
 * Hex-Level Checkpointing (S-126)
 *
 * Tracks completed hexes in a JSON file so the pipeline can resume
 * after crashes without repeating work. The hex grid is deterministic,
 * so only completed hex IDs need to be stored.
 *
 * File: scripts/cache/pipeline-checkpoint.json
 */

import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

export interface CheckpointData {
  runId: string;
  completedHexes: string[];
}

// Resolve relative to repo root — scripts/cache/ is the canonical location
const CHECKPOINT_PATH = join(process.cwd(), "scripts", "cache", "pipeline-checkpoint.json");

/**
 * Load checkpoint from disk. Returns null if no checkpoint exists
 * or if the checkpoint is for a different run.
 */
export function loadCheckpoint(runId: string): CheckpointData | null {
  try {
    const raw = readFileSync(CHECKPOINT_PATH, "utf-8");
    const data = JSON.parse(raw) as CheckpointData;
    if (data.runId !== runId) {
      // Different run — stale checkpoint, ignore it
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Load checkpoint regardless of runId — used to resume the most recent run.
 */
export function loadLatestCheckpoint(): CheckpointData | null {
  try {
    const raw = readFileSync(CHECKPOINT_PATH, "utf-8");
    return JSON.parse(raw) as CheckpointData;
  } catch {
    return null;
  }
}

/**
 * Mark a hex as completed in the checkpoint file.
 * Writes atomically (read → append → write).
 */
export function markHexCompleted(runId: string, hexId: string): void {
  let data: CheckpointData;
  try {
    const raw = readFileSync(CHECKPOINT_PATH, "utf-8");
    data = JSON.parse(raw) as CheckpointData;
    if (data.runId !== runId) {
      // New run — start fresh
      data = { runId, completedHexes: [] };
    }
  } catch {
    data = { runId, completedHexes: [] };
  }

  if (!data.completedHexes.includes(hexId)) {
    data.completedHexes.push(hexId);
  }

  writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2));
}

/**
 * Delete the checkpoint file when the pipeline completes successfully.
 */
export function clearCheckpoint(): void {
  try {
    unlinkSync(CHECKPOINT_PATH);
  } catch {
    // File doesn't exist — that's fine
  }
}
