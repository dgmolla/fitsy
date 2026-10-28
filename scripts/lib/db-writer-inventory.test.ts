import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as ts from "typescript";

const root = resolve(__dirname, "../..");
// These proposal/audit entrypoints only read the database. Mutations invalidate the exception.
const readOnly = new Set([
  "scripts/phase1-precision.ts", "scripts/phase1-verify-aliases.ts", "scripts/phase1-coverage-report.ts",
  "scripts/phase1-miss-impact.ts", "scripts/phase0-llm-tiebreak.ts", "scripts/phase0-detect-chains.ts",
  "scripts/phase1-align.ts", "scripts/phase1-discover-official.ts", "scripts/phase1-land.ts",
  "scripts/ghost-sample.ts", "scripts/ghost-coords.ts", "scripts/chain-coverage-audit.ts",
]);
const guards = new Set(["assertDatabaseWriteAllowed", "assertDevDatabase", "assertNotProd"]);
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

test("every script Prisma client binds its actual datasource to a shared guard or a read-only exception", () => {
  const errors: string[] = [];
  for (const file of [...files(join(root, "scripts")), join(root, "prisma/seed.ts")].filter(path => path.endsWith(".ts") && !path.endsWith(".test.ts"))) {
    const text = readFileSync(file, "utf8"), path = relative(root, file);
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const bindings = new Map<string, ts.Expression>();
    const clients: ts.NewExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer);
      if (ts.isNewExpression(node) && node.expression.getText(source) === "PrismaClient") clients.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!clients.length) continue;
    if (readOnly.has(path)) {
      // The exception must not grow a mutation via ORM methods or raw SQL.
      if (/\b(?:p|prisma)\.(?:\w+\.)?(?:create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw(?:Unsafe)?)\s*[(\x60]/.test(text) ||
          /(?:\x60|["'])\s*(?:INSERT\s+INTO|UPDATE\s+["a-z]|DELETE\s+FROM|TRUNCATE|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(text)) errors.push(path + ": read-only exception now mutates");
      continue;
    }
    const guarded = (node: ts.Node, seen = new Set<string>()): boolean => {
      if (ts.isCallExpression(node) && guards.has(node.expression.getText(source))) return true;
      // Snapshot's separately pinned source session is explicitly made read-only before queries.
      if (path === "scripts/dev/snapshot.ts" && ts.isCallExpression(node) && node.expression.getText(source) === "prodReadOnlyUrl") return true;
      // This operator-only entrypoint pins PROD and checks the typed project ref.
      // Its CLI tests also require --prod and a TTY before either client exists.
      if (path === "scripts/maintenance/provision-prod-readonly-role.ts" && ts.isCallExpression(node) && node.expression.getText(source) === "confirmedProdAuditUrl") return true;
      if (ts.isIdentifier(node) && !seen.has(node.text) && bindings.has(node.text)) return guarded(bindings.get(node.text)!, new Set([...seen, node.text]));
      return ts.forEachChild(node, child => guarded(child, seen) || undefined) === true;
    };
    for (const client of clients) if (!client.arguments?.some(arg => guarded(arg))) errors.push(path + ": unguarded Prisma datasource");
  }
  expect(errors).toEqual([]);
});
