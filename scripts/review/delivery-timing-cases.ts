import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Context = {
  root: () => string; env: () => NodeJS.ProcessEnv; source: string;
  run: (model?: string) => ReturnType<typeof spawnSync>;
  runPr: (lens?: string, body?: string) => ReturnType<typeof spawnSync>;
  git: (...args: string[]) => string;
};
// Register against the real runner fixture and its existing lifecycle hooks.
export function deliveryTimingCases(fixture: Context) {
const { source, run, runPr, git } = fixture;
test("PR timing isolates issue ownership and refuses ambiguous or changed bindings", () => {
  const root = fixture.root(), env = fixture.env();
  mkdirSync(join(root, "scripts/delivery"), { recursive: true });
  cpSync(join(source, "scripts/delivery/phase-events.mjs"), join(root, "scripts/delivery/phase-events.mjs"));
  const bind = spawnSync(process.execPath, ["scripts/delivery/phase-events.mjs", "bind", "--issue", "999"],
    { cwd: root, env, encoding: "utf8" });
  expect(bind.status).toBe(0);
  // External GitHub transport only; all binding/event/publishing code is real.
  writeFileSync(join(root, "bin/gh"), `#!/usr/bin/env python3
import json,pathlib,sys
store=pathlib.Path(${JSON.stringify(join(root, 'timing-comments'))})
comments=json.loads(store.read_text()) if store.exists() else []
method,path=sys.argv[3:5]
if path=='user': print(json.dumps({'login':'fixture'}))
elif method=='GET': print(json.dumps(comments))
elif method=='POST':
 data=json.load(sys.stdin); comment={'id':len(comments)+1,'user':{'login':'fixture'},'body':data['body']}
 comments.append(comment); store.write_text(json.dumps(comments)); print(json.dumps(comment))
elif method=='PATCH':
 data=json.load(sys.stdin); comment=next(c for c in comments if c['id']==int(path.split('/')[-1]))
 comment['body']=data['body']; store.write_text(json.dumps(comments)); print(json.dumps(comment))
else: sys.exit(1)
`, { mode: 0o755 });
  const result = runPr("correctness", "Delivery-Issue: #355\n");
  expect(result.status).toBe(0);
  const caller = JSON.parse(readFileSync(join(root, ".evidence/delivery/binding.json"), "utf8"));
  expect(caller.issue).toBe(999);
  const context = join(root, ".evidence/review-delivery/123/.evidence/delivery");
  const binding = JSON.parse(readFileSync(join(context, "binding.json"), "utf8"));
  expect(binding.issue).toBe(355);
  const rows = readFileSync(join(context, "events.jsonl"), "utf8");
  expect(rows.trim().split("\n").map(line => JSON.parse(line))).toEqual([
    expect.objectContaining({ issue: 355, phase: "review", status: "running" }),
    expect.objectContaining({ issue: 355, phase: "review", status: "pass" }),
  ]);
  expect(JSON.parse(readFileSync(join(root, "timing-comments"), "utf8"))).toHaveLength(1);
  for (const body of ["", "Delivery-Issue: #355\nDelivery-Issue: #356\n", "Delivery-Issue: #356\n"]) {
    const gap = runPr("correctness", body);
    expect(gap.status).toBe(0);
    expect(gap.stderr).toContain("timing gap");
    expect(readFileSync(join(context, "events.jsonl"), "utf8")).toBe(rows);
  }
});


test("local timing records pass, cached reuse, and failed independent reviews", () => {
  const root = fixture.root(), env = fixture.env();
  mkdirSync(join(root, "scripts/delivery"), { recursive: true });
  cpSync(join(source, "scripts/delivery/phase-events.mjs"), join(root, "scripts/delivery/phase-events.mjs"));
  expect(spawnSync(process.execPath, ["scripts/delivery/phase-events.mjs", "bind", "--issue", "355"],
    { cwd: root, env, encoding: "utf8" }).status).toBe(0);
  expect(run().status).toBe(0);
  expect(run().status).toBe(0);
  writeFileSync(join(root, "exit"), "1");
  expect(run("failing-model").status).toBe(1);
  const events = readFileSync(join(root, ".evidence/delivery/events.jsonl"), "utf8")
    .trim().split("\n").map(line => JSON.parse(line));
  const terminal = events.filter(event => event.status !== "running");
  expect(terminal.map(event => event.status)).toEqual(["pass", "cached", "fail"]);
  expect(terminal.every(event => event.issue === 355 && event.phase === "review" && event.lens === "correctness")).toBe(true);
  expect(terminal[1].duration_ms).toBe(0);
  expect(new Set(terminal.map(event => event.attempt_id)).size).toBe(3);
  expect(new Set(terminal.map(event => event.round_id))).toEqual(new Set([git("rev-parse", "HEAD").trim()]));
});

}
