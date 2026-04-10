/**
 * Eval V2 — HTML report generator.
 *
 * Generates a self-contained HTML file with:
 * 1. Prompt leaderboard (sorted by accuracy)
 * 2. Per-case detail tables for each prompt
 * 3. Color-coded error cells (green < 15%, yellow < 30%, red > 30%)
 */

import type { PromptResult } from "./run.js";
import { PROMPT_MAP } from "./prompts.js";

function errorColor(pct: number): string {
  if (pct < 15) return "#22c55e"; // green
  if (pct < 30) return "#eab308"; // yellow
  return "#ef4444"; // red
}

function errorBg(pct: number): string {
  if (pct < 15) return "#f0fdf4";
  if (pct < 30) return "#fefce8";
  return "#fef2f2";
}

function badge(pct: number): string {
  return `<span style="background:${errorBg(pct)};color:${errorColor(pct)};padding:2px 8px;border-radius:4px;font-weight:600">${pct.toFixed(1)}%</span>`;
}

function macroCell(actual: number, expected: number, unit: string = ""): string {
  const err = expected > 0 ? (Math.abs(actual - expected) / expected) * 100 : 0;
  const arrow = actual > expected ? "↑" : actual < expected ? "↓" : "=";
  const color = errorColor(err);
  return `<td style="background:${errorBg(err)}">
    <strong>${actual}${unit}</strong>
    <br><small style="color:${color}">${arrow} ${err.toFixed(0)}% off ${expected}${unit}</small>
  </td>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function generateReport(
  model: string,
  timestamp: string,
  results: PromptResult[],
  sampleCase?: Record<string, unknown>,
  numRuns: number = 1,
): string {
  // Leaderboard rows
  const leaderboardRows = results
    .map((r, i) => {
      const medal = i === 0 ? " 🥇" : i === 1 ? " 🥈" : i === 2 ? " 🥉" : "";
      return `<tr>
        <td>${i + 1}${medal}</td>
        <td><strong>${r.promptLabel}</strong><br><code>${r.promptId}</code></td>
        <td>${badge(r.aggregate.meanCalError)}</td>
        <td>${badge(r.aggregate.meanProteinError)}</td>
        <td>${badge(r.aggregate.meanCarbsError)}</td>
        <td>${badge(r.aggregate.meanFatError)}</td>
        <td>${badge(r.aggregate.meanOverallError)}</td>
        <td>$${r.aggregate.totalCostUsd.toFixed(4)}</td>
        <td>${(r.aggregate.totalLatencyMs / 1000).toFixed(1)}s</td>
      </tr>`;
    })
    .join("\n");

  // Detail sections per prompt
  const detailSections = results
    .map((r) => {
      const caseRows = r.cases
        .map((c) => {
          return `<tr>
            <td>
              <strong>${c.caseName}</strong>
              <br><small>${c.restaurant}</small>
            </td>
            ${macroCell(c.actual.calories, c.expected.calories, " cal")}
            ${macroCell(c.actual.proteinG, c.expected.proteinG, "g")}
            ${macroCell(c.actual.carbsG, c.expected.carbsG, "g")}
            ${macroCell(c.actual.fatG, c.expected.fatG, "g")}
            <td><code>${c.actual.confidence}</code></td>
          </tr>`;
        })
        .join("\n");

      // Generate sample prompt text if we have a sample case
      let promptBlock = "";
      if (sampleCase) {
        const promptDef = PROMPT_MAP.get(r.promptId);
        if (promptDef) {
          const { system, user } = promptDef.buildMessages(sampleCase);
          promptBlock = `
            <details style="margin:8px 0 12px">
              <summary style="cursor:pointer;color:#6366f1;font-size:0.85em;font-weight:600">Show prompt</summary>
              <div style="margin-top:8px">
                <div style="margin-bottom:8px">
                  <div style="font-size:0.75em;font-weight:600;text-transform:uppercase;color:#888;margin-bottom:2px">System</div>
                  <pre style="background:#f8f8f8;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:0.8em;white-space:pre-wrap;max-height:300px;overflow-y:auto">${escapeHtml(system)}</pre>
                </div>
                <div>
                  <div style="font-size:0.75em;font-weight:600;text-transform:uppercase;color:#888;margin-bottom:2px">User</div>
                  <pre style="background:#f8f8f8;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:0.8em;white-space:pre-wrap">${escapeHtml(user)}</pre>
                </div>
              </div>
            </details>`;
        }
      }

      return `
        <h3>${r.promptLabel} <code style="font-size:0.7em;color:#888">${r.promptId}</code></h3>
        <p style="color:#666;margin:4px 0 12px">Overall error: ${badge(r.aggregate.meanOverallError)}</p>
        ${promptBlock}
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Calories</th>
              <th>Protein</th>
              <th>Carbs</th>
              <th>Fat</th>
              <th>Conf</th>
            </tr>
          </thead>
          <tbody>
            ${caseRows}
          </tbody>
        </table>`;
    })
    .join("\n<hr>\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Eval V2 — Macro Estimation Prompt Lab</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 24px; background: #fafafa; color: #1a1a1a; }
    h1 { font-size: 1.5em; margin-bottom: 4px; }
    h2 { font-size: 1.2em; margin: 32px 0 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
    h3 { font-size: 1.05em; margin-top: 24px; }
    .meta { color: #888; font-size: 0.85em; margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 0.9em; }
    th, td { padding: 8px 12px; text-align: left; border: 1px solid #e5e7eb; }
    th { background: #f3f4f6; font-weight: 600; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.03em; }
    tr:hover { background: #f9fafb; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    small { font-size: 0.8em; }
  </style>
</head>
<body>
  <h1>Eval V2 — Macro Estimation Prompt Lab</h1>
  <p class="meta">Model: <code>${model}</code> | ${timestamp} | ${results.length} prompts × ${results[0]?.cases.length ?? 0} cases${numRuns > 1 ? ` × ${numRuns} runs (averaged)` : ""}</p>

  <h2>Prompt Leaderboard</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Prompt</th>
        <th>Cal Err</th>
        <th>Protein Err</th>
        <th>Carbs Err</th>
        <th>Fat Err</th>
        <th>Overall</th>
        <th>Cost</th>
        <th>Latency</th>
      </tr>
    </thead>
    <tbody>
      ${leaderboardRows}
    </tbody>
  </table>

  <h2>Per-Case Details</h2>
  ${detailSections}
</body>
</html>`;
}
