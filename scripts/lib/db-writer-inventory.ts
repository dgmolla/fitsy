/** Fail closed on connection entrypoints, including aliases and test datasource overrides. */
import { dirname, posix } from 'node:path';
import * as ts from 'typescript';

const readOnly = new Set([
  'scripts/phase1-precision.ts', 'scripts/phase1-verify-aliases.ts', 'scripts/phase1-coverage-report.ts',
  'scripts/phase1-miss-impact.ts', 'scripts/phase0-llm-tiebreak.ts', 'scripts/phase0-detect-chains.ts',
  'scripts/phase1-align.ts', 'scripts/phase1-discover-official.ts', 'scripts/phase1-land.ts',
  'scripts/ghost-sample.ts', 'scripts/ghost-coords.ts', 'scripts/chain-coverage-audit.ts',
]);
const guardModules: Record<string, string[]> = {
  'scripts/lib/db-target-guard': ['assertDatabaseWriteAllowed', 'assertPipelineDatabase', 'assertDevDatabase', 'assertRuntimeDatabase', 'assertDevSupabase', 'assertRuntimeSupabase'],
  'scripts/lib/test-database-guard': ['assertTestDatabase'],
  'scripts/dev/lib/guard': ['assertNotProd', 'prodReadOnlyUrl'],
  'scripts/deploy/hex-jobs-recovery-target': ['recoveryTarget'],
};
const mutation = /\b(?:INSERT\s+INTO|UPDATE\s+["\w]|DELETE\s+FROM|TRUNCATE|CREATE\s+(?:TABLE|ROLE|POLICY|INDEX)|ALTER\s+(?:TABLE|ROLE|DEFAULT)|DROP\s+(?:TABLE|DATABASE)|GRANT|REVOKE)\b/i;
const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)
    ? unwrap(node.expression) : node;

function clientErrors(path: string, text: string, sources: ReadonlyMap<string, string>): string[] {
  const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const options = { noResolve: true, noLib: true, allowJs: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === path ? source : undefined;
  const checker = ts.createProgram([path], options, host).getTypeChecker();
  const declarations = (node: ts.Node) => (ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node))?.declarations ?? [];
  const moduleOf = (node: ts.Node): string | undefined => {
    for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
      if (ts.isImportDeclaration(parent) && ts.isStringLiteral(parent.moduleSpecifier)) return parent.moduleSpecifier.text;
    }
    return undefined;
  };
  const imported = (node: ts.Identifier) => declarations(node).flatMap(declaration => {
    if (!ts.isImportSpecifier(declaration) || declarations(node).length !== 1) return [];
    const from = moduleOf(declaration);
    return from ? [{ from: posix.normalize(posix.join(dirname(path), from)).replace(/\.(?:ts|js)$/, ''),
      name: (declaration.propertyName ?? declaration.name).text }] : [];
  });
  function guarded(expression: ts.Expression, seen = new Set<ts.Node>(), awaited = false): boolean {
    const node = unwrap(expression);
    if (seen.has(node)) return false;
    seen = new Set([...seen, node]);
    if (ts.isAwaitExpression(node)) return guarded(node.expression, seen, true);
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && imported(node.expression).some(({ from, name }) => guardModules[from]?.includes(name) &&
          (!testFile || name === 'assertTestDatabase') &&
          (!name.startsWith('assertRuntime') || path.startsWith('apps/api/')) &&
          (name !== 'recoveryTarget' || path === 'scripts/deploy/recover-hex-jobs.ts') &&
          (!['assertDatabaseWriteAllowed', 'assertPipelineDatabase', 'recoveryTarget'].includes(name) || awaited) && (name !== 'prodReadOnlyUrl' || path === 'scripts/dev/snapshot.ts'))) return true;
      // The alternative cleanup path is an enforced READ ONLY transaction.
      if (path === 'scripts/maintenance/cleanup-test-fixtures.ts' && node.expression.getText(source) === 'cleanupReadTarget') return true;
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'toString') return guarded(node.expression.expression, seen);
      if (ts.isIdentifier(node.expression)) {
        for (const declaration of declarations(node.expression)) if (ts.isFunctionDeclaration(declaration) && declaration.body &&
            (!declaration.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) || awaited)) {
          const returns: ts.Expression[] = [];
          const collect = (child: ts.Node) => {
            if (ts.isReturnStatement(child) && child.expression) returns.push(child.expression);
            else if (!ts.isFunctionLike(child)) ts.forEachChild(child, collect);
          };
          collect(declaration.body);
          if (returns.length && returns.every(value => guarded(value, seen))) return true;
        }
      }
    }
    if (ts.isConditionalExpression(node)) return guarded(node.whenTrue, seen) && guarded(node.whenFalse, seen);
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'URL' && node.arguments?.[0]) return guarded(node.arguments[0], seen);
    if (ts.isIdentifier(node)) return declarations(node).some(declaration => ts.isVariableDeclaration(declaration) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && !!declaration.initializer && guarded(declaration.initializer, seen));
    return false;
  }
  function property(expression: ts.Expression | undefined, name: string, seen = new Set<ts.Node>()): ts.Expression | undefined {
    if (!expression || seen.has(expression)) return undefined;
    seen.add(expression);
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      for (const declaration of declarations(node)) if (ts.isVariableDeclaration(declaration)) {
        const value = property(declaration.initializer, name, seen); if (value) return value;
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      if (node.properties.some(ts.isSpreadAssignment)) return undefined;
      const entries = node.properties.filter(item => item.name?.getText(source).replace(/["']/g, '') === name);
      if (entries.length !== 1) return undefined;
      const entry = entries[0];
      if (entry && ts.isPropertyAssignment(entry)) return entry.initializer;
      if (entry && ts.isShorthandPropertyAssignment(entry)) return entry.name;
    }
    return undefined;
  }
  function databaseClient(expression: ts.Expression, seen = new Set<ts.Node>()): 'prisma' | 'sql' | 'supabase' | undefined {
    const node = unwrap(expression);
    if (seen.has(node)) return undefined;
    seen = new Set([...seen, node]);
    if (ts.isIdentifier(node)) {
      for (const declaration of declarations(node)) {
        const module = moduleOf(declaration);
        if (module === '@prisma/client' && ts.isImportSpecifier(declaration) && (declaration.propertyName ?? declaration.name).text === 'PrismaClient') return 'prisma';
        if (module === '@supabase/supabase-js' && ts.isImportSpecifier(declaration) && (declaration.propertyName ?? declaration.name).text === 'createClient') return 'supabase';
        if (['pg', 'postgres', 'postgresql-client'].includes(module ?? '')) return 'sql';
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
          const kind = databaseClient(declaration.initializer, seen); if (kind) return kind;
        }
        if (ts.isBindingElement(declaration)) {
          const variable = declaration.parent.parent;
          if (ts.isVariableDeclaration(variable) && variable.initializer) {
            const kind = databaseClient(variable.initializer, seen); if (kind) return kind;
          }
        }
      }
      if (node.text === 'PrismaClient') return 'prisma';
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === 'PrismaClient') return 'prisma';
      return databaseClient(node.expression, seen);
    }
    if (ts.isConditionalExpression(node)) return databaseClient(node.whenTrue, seen) ?? databaseClient(node.whenFalse, seen);
    if (ts.isAwaitExpression(node)) return databaseClient(node.expression, seen);
    if (ts.isCallExpression(node) && ['require', 'import'].includes(node.expression.getText(source))) {
      const module = node.arguments[0];
      if (module && ts.isStringLiteral(module)) {
        if (module.text === '@prisma/client') return 'prisma';
        if (module.text === '@supabase/supabase-js') return 'supabase';
        if (['pg', 'postgres', 'postgresql-client'].includes(module.text)) return 'sql';
      }
    }
    return undefined;
  }
  const workspace = path.startsWith('apps/api/') ? 'apps/api' : path.startsWith('scripts/') ? 'scripts' : undefined;
  const config = workspace && sources.get(`${workspace}/jest.config.js`);
  const testGuard = testFile && !!config &&
    /globalSetup:\s*["']<rootDir>\/(?:\.\.\/\.\.\/scripts\/)?lib\/test-database-guard\.ts["']/.test(config);
  const errors: string[] = [];
  let clients = 0;
  let ormMutation = false;
  const instance = (expression: ts.Expression): boolean => {
    const node = unwrap(expression);
    if (ts.isPropertyAccessExpression(node)) return instance(node.expression);
    if (ts.isIdentifier(node)) return declarations(node).some(declaration => {
      if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return false;
      const value = unwrap(declaration.initializer);
      return ts.isNewExpression(value) && !!databaseClient(value.expression);
    });
    return false;
  };
  const visit = (node: ts.Node) => {
    const invoked = ts.isCallExpression(node) ? node.expression : ts.isTaggedTemplateExpression(node) ? node.tag : undefined;
    if (invoked && ts.isPropertyAccessExpression(invoked) && instance(invoked.expression) &&
        /^(?:create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw(?:Unsafe)?)$/.test(invoked.name.text)) ormMutation = true;
    if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
      const kind = databaseClient(node.expression);
      if (kind && !['require', 'import'].includes(node.expression.getText(source))) {
        clients++;
        const options = node.arguments?.[0];
        const target = kind === 'prisma'
          ? property(options, 'datasourceUrl') ?? property(property(property(options, 'datasources'), 'db'), 'url')
          : property(options, 'connectionString') ?? options;
        // Mobile's public client is Auth-only; application tables have no client grants.
        const mobileAuth = path === 'apps/mobile/lib/supabase.ts' && kind === 'supabase' &&
          node.arguments?.[1]?.getText(source) === 'SUPABASE_ANON_KEY' && !/\.from\s*\(/.test(text);
        if (!mobileAuth && !readOnly.has(path) && !(target && guarded(target)) && !(kind === 'prisma' && !target && testGuard &&
            (!options || (ts.isObjectLiteralExpression(options) && !options.properties.some(item =>
              ts.isSpreadAssignment(item) || ['datasources', 'datasourceUrl', 'adapter'].includes(item.name?.getText(source) ?? '')))))) {
          errors.push(`${path}: unguarded ${kind} datasource at line ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (clients && readOnly.has(path) && (mutation.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')) || ormMutation)) errors.push(`${path}: read-only exception now mutates`);
  return errors;
}

export function unguardedDatabaseWriters(sources: ReadonlyMap<string, string>): string[] {
  const errors: string[] = [];
  for (const [path, text] of sources) {
    if (/\.[cm]?[jt]sx?$/.test(path) && /PrismaClient|["'](?:pg|postgres|postgresql-client|@supabase\/supabase-js)["']/.test(text)) {
      try { errors.push(...clientErrors(path, text, sources)); }
      catch (error) { throw new Error(`${path}: writer inventory could not analyze source`, { cause: error }); }
    }
    if (path.endsWith('.sql')) {
      const sql = text.replace(/--[^\n]*/g, '');
      if (/^prisma\/migrations\/[^/]+\/(?:migration|down)\.sql$/.test(path)) continue;
      // Historical proposal removed from migration discovery; never an executable owner.
      if (path === 'docs/engineering/backend/rls-policies-parked.sql' && text.includes('DO NOT APPLY')) continue;
      if (!/^\s*BEGIN\s+READ\s+ONLY\s*;/i.test(sql) || !/\b(?:ROLLBACK|COMMIT)\s*;\s*$/i.test(sql) ||
          mutation.test(sql) || (sql.match(/\b(?:COMMIT|ROLLBACK|BEGIN)\b/gi)?.length !== 2)) errors.push(`${path}: SQL needs a guarded owner or one read-only transaction`);
    }
    if (path === 'package.json' || path.endsWith('/package.json')) {
      const manifest = JSON.parse(text) as { scripts?: Record<string, string> };
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        if (/\bpsql\b|\bprisma\s+(?:migrate\s+(?:deploy|dev|reset)|db\s+(?:execute|push|seed))\b/.test(command)) errors.push(`${path} scripts.${name}: use a maintained guarded database entrypoint`);
      }
    }
    if (/\.(?:sh|ya?ml)$/.test(path) || path.startsWith('.githooks/')) {
      const shell = text.replace(/^\s*#.*$/gm, '');
      const command = /(?:^|[;|{\n]|\brun:\s*["']?)\s*(?:[A-Z_]+=[^\n ]+\s+)*(?:npx\s+)?(?:psql\b|prisma\s+(?:migrate\s+(?:deploy|dev|reset)|db\s+(?:execute|push|seed))\b)/m.exec(shell);
      if (command) {
        const before = shell.slice(0, command.index);
        const owner = ['scripts/deploy/migrate-prod.sh', 'scripts/dev/vercel-build.sh', 'scripts/dev/provision-supabase.sh'].includes(path);
        if (!(owner && before.includes('node --import tsx scripts/lib/db-target-guard.ts') &&
            before.includes('--env=POSTGRES_URL_NON_POOLING') && /set -e(?:uo)?\b/.test(before))) {
          if (!(path === 'scripts/verify/dev-drift.sh' && !mutation.test(shell) && /Q\(\) \{ psql "\$URL" -Atqc "\$1"; \}/.test(shell))) errors.push(`${path}: shell database command lacks a preceding fail-closed target guard`);
        }
      }
    }
    if (/\.[cm]?[jt]s$/.test(path) && !/\.(?:test|spec)\./.test(path) &&
        /["']psql["']|["'](?:migrate|db)["']\s*,\s*["'](?:deploy|push|execute|reset)["']/.test(text)) {
      if (!(path === 'scripts/verify/local-db-control.mjs' && text.includes("'scripts/lib/db-target-guard.ts', '--dev-only'") &&
          text.includes('if (guard.status !== 0) throw') && text.includes('pinnedOwned(container)'))) errors.push(`${path}: external database command must use the guarded owned launcher`);
    }
  }
  return errors;
}
