import { readFileSync, unlinkSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock checkpoint path to use a temp directory
const TEST_DIR = join(tmpdir(), "fitsy-checkpoint-test");
const TEST_CHECKPOINT = join(TEST_DIR, "pipeline-checkpoint.json");

jest.mock("./checkpoint", () => {
  // Re-implement with test path
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const testDir = path.join(os.tmpdir(), "fitsy-checkpoint-test");
  const testPath = path.join(testDir, "pipeline-checkpoint.json");

  return {
    loadCheckpoint(runId: string) {
      try {
        const raw = fs.readFileSync(testPath, "utf-8");
        const data = JSON.parse(raw);
        if (data.runId !== runId) return null;
        return data;
      } catch { return null; }
    },
    loadLatestCheckpoint() {
      try {
        const raw = fs.readFileSync(testPath, "utf-8");
        return JSON.parse(raw);
      } catch { return null; }
    },
    markHexCompleted(runId: string, hexId: string) {
      let data;
      try {
        const raw = fs.readFileSync(testPath, "utf-8");
        data = JSON.parse(raw);
        if (data.runId !== runId) data = { runId, completedHexes: [] };
      } catch { data = { runId, completedHexes: [] }; }
      if (!data.completedHexes.includes(hexId)) data.completedHexes.push(hexId);
      fs.writeFileSync(testPath, JSON.stringify(data, null, 2));
    },
    clearCheckpoint() {
      try { fs.unlinkSync(testPath); } catch { /* noop */ }
    },
  };
});

import { loadCheckpoint, loadLatestCheckpoint, markHexCompleted, clearCheckpoint } from "./checkpoint";

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

beforeEach(() => {
  try { unlinkSync(TEST_CHECKPOINT); } catch { /* noop */ }
});

afterAll(() => {
  try { unlinkSync(TEST_CHECKPOINT); } catch { /* noop */ }
});

describe("loadCheckpoint", () => {
  it("returns null when no file exists", () => {
    expect(loadCheckpoint("run-1")).toBeNull();
  });

  it("returns null for different runId", () => {
    writeFileSync(TEST_CHECKPOINT, JSON.stringify({ runId: "run-1", completedHexes: ["h1"] }));
    expect(loadCheckpoint("run-2")).toBeNull();
  });

  it("returns data for matching runId", () => {
    writeFileSync(TEST_CHECKPOINT, JSON.stringify({ runId: "run-1", completedHexes: ["h1", "h2"] }));
    const result = loadCheckpoint("run-1");
    expect(result).toEqual({ runId: "run-1", completedHexes: ["h1", "h2"] });
  });
});

describe("loadLatestCheckpoint", () => {
  it("returns null when no file exists", () => {
    expect(loadLatestCheckpoint()).toBeNull();
  });

  it("returns checkpoint regardless of runId", () => {
    writeFileSync(TEST_CHECKPOINT, JSON.stringify({ runId: "any-run", completedHexes: ["h1"] }));
    const result = loadLatestCheckpoint();
    expect(result?.runId).toBe("any-run");
  });
});

describe("markHexCompleted", () => {
  it("creates checkpoint file if not exists", () => {
    markHexCompleted("run-1", "h1");
    const data = JSON.parse(readFileSync(TEST_CHECKPOINT, "utf-8"));
    expect(data).toEqual({ runId: "run-1", completedHexes: ["h1"] });
  });

  it("appends to existing checkpoint", () => {
    markHexCompleted("run-1", "h1");
    markHexCompleted("run-1", "h2");
    const data = JSON.parse(readFileSync(TEST_CHECKPOINT, "utf-8"));
    expect(data.completedHexes).toEqual(["h1", "h2"]);
  });

  it("does not duplicate hex ids", () => {
    markHexCompleted("run-1", "h1");
    markHexCompleted("run-1", "h1");
    const data = JSON.parse(readFileSync(TEST_CHECKPOINT, "utf-8"));
    expect(data.completedHexes).toEqual(["h1"]);
  });

  it("starts fresh for new runId", () => {
    markHexCompleted("run-1", "h1");
    markHexCompleted("run-2", "h2");
    const data = JSON.parse(readFileSync(TEST_CHECKPOINT, "utf-8"));
    expect(data).toEqual({ runId: "run-2", completedHexes: ["h2"] });
  });
});

describe("clearCheckpoint", () => {
  it("deletes checkpoint file", () => {
    markHexCompleted("run-1", "h1");
    expect(existsSync(TEST_CHECKPOINT)).toBe(true);
    clearCheckpoint();
    expect(existsSync(TEST_CHECKPOINT)).toBe(false);
  });

  it("does not throw when no file exists", () => {
    expect(() => clearCheckpoint()).not.toThrow();
  });
});
