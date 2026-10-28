import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function readManifest() {
  return JSON.parse(readFileSync(new URL('./env-manifest.json', import.meta.url), 'utf8'));
}

/** Values never leave the process; diagnostics contain names only. */
export function assertRequiredEnvironment(target, env = process.env, manifest = readManifest()) {
  const required = manifest.required[target];
  if (!Array.isArray(required) || required.length === 0) throw new Error('Unknown environment target');
  const missing = required.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) throw new Error(`Missing required environment variable names (${target}): ${missing.join(', ')}`);
  return required;
}

export async function environmentReads(source, file) {
  const { default: ts } = await import('typescript');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const reads = [];
  const isEnv = node => ts.isPropertyAccessExpression(node) && node.expression.getText(tree) === 'process' && node.name.text === 'env';
  function visit(node) {
    if (ts.isPropertyAccessExpression(node) && isEnv(node.expression)) reads.push({ name: node.name.text });
    if (ts.isElementAccessExpression(node) && isEnv(node.expression)) {
      const key = node.argumentExpression;
      reads.push(ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)
        ? { name: key.text } : { expression: key.getText(tree) });
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isEnv(node.initializer) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue;
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) reads.push({ name: key.text });
        else reads.push({ expression: key.getText(tree) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return reads;
}

export async function checkEnvironmentSources(files, manifest = readManifest()) {
  const known = new Set([...Object.values(manifest.required).flat(), ...manifest.optional, ...manifest.providerManaged]);
  const failures = [];
  for (const { file, source } of files) {
    for (const read of await environmentReads(source, file)) {
      if (read.name && !known.has(read.name)) failures.push(`${file}: unlisted variable ${read.name}`);
      if (read.expression && !manifest.dynamicReads.some(item => item.file === file && item.expression === read.expression)) {
        failures.push(`${file}: unlisted dynamic environment selector ${read.expression}`);
      }
    }
  }
  return failures;
}

export function sourceFiles(root = process.cwd()) {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0');
  return [...new Set(paths)].filter(file => /^(apps|packages|scripts)\//.test(file) && /\.(c?[jt]sx?|mjs)$/.test(file)
    && !/(\.test\.|\.d\.ts$|\/(__mocks__|fixtures|node_modules)\/)/.test(file))
    .map(file => ({ file, source: readFileSync(resolve(root, file), 'utf8') }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = process.argv.find(argument => argument.startsWith('--target='))?.slice('--target='.length);
    if (target) {
      assertRequiredEnvironment(target);
      console.log(`Environment manifest passed for ${target} (names only)`);
    } else {
      const failures = await checkEnvironmentSources(sourceFiles());
      if (failures.length) throw new Error(failures.join('\n'));
      console.log('Environment source manifest passed');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
