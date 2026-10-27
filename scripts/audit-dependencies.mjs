import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assessAudit, readAuditGraph } from './audit-policy.mjs';

/** Run a real production audit. Injection is limited to tests; the CLI exposes no bypass options. */
export function auditProject({
  projectRoot,
  policy,
  now = Date.now(),
  run = spawnSync,
  env = process.env,
}) {
  const args = ['audit', '--omit=dev', '--omit=peer', '--audit-level=high', '--json'];
  // npm_execpath avoids shell execution of npm.cmd when invoked by npm scripts on Windows.
  const npmCLI = env.npm_execpath;
  const command = npmCLI ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = run(command, npmCLI ? [npmCLI, ...args] : args, {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
    shell: !npmCLI && process.platform === 'win32',
  });
  const failed = (message) => ({ ok: false, errors: [message], accepted: [] });
  if (child.error || child.signal || ![0, 1].includes(child.status))
    return failed('npm audit could not complete; no exception was applied.');
  let report;
  try {
    report = JSON.parse(child.stdout);
  } catch {
    return failed('npm audit did not return valid JSON; no exception was applied.');
  }
  if (report?.error) return failed('npm audit returned an error; no exception was applied.');
  let graph;
  try {
    graph = readAuditGraph(projectRoot, policy, now);
  } catch (error) {
    return failed('Dependency/policy verification failed: ' + error.message);
  }
  return { ...assessAudit({ report, exitCode: child.status, policy, graph, now }), report };
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const policy = JSON.parse(
    readFileSync(new URL('./security-exceptions.json', import.meta.url), 'utf8')
  );
  const result = auditProject({ projectRoot: root, policy });
  if (result.report) {
    console.log(
      'Production npm audit:',
      result.report.metadata?.vulnerabilities || 'invalid report'
    );
    for (const [name, finding] of Object.entries(result.report.vulnerabilities || {})) {
      console.log(`${finding.severity}: ${name} (${(finding.nodes || []).join(', ')})`);
      for (const via of finding.via || []) if (typeof via === 'object') console.log('  ' + via.url);
    }
  }
  if (!result.ok) {
    for (const error of new Set(result.errors)) console.error(error);
    process.exitCode = 1;
    return;
  }
  if (result.accepted.length) {
    console.warn(
      `TEMPORARY ACCEPTED RISK ${result.exceptionId}; expires ${result.expiresAt}. Vulnerabilities remain in the published dependency tree.`
    );
    for (const item of result.accepted)
      console.warn(`  accepted ${item.name}@${item.version}: ${item.path}`);
  } else console.log('Production audit passed without accepting a finding.');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch {
    console.error('Security audit could not verify its report/policy. No exception was applied.');
    process.exitCode = 1;
  }
}
