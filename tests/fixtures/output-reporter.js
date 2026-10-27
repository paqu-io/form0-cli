export default async function* testOutputReporter(events) {
  const report = { passed: [], failed: [], diagnostics: [], stdout: [], stderr: [] };
  for await (const event of events) {
    if (event.type === 'test:pass') report.passed.push(event.data.name);
    if (event.type === 'test:fail') {
      report.failed.push({ name: event.data.name, message: event.data.details?.error?.message });
    }
    if (event.type === 'test:diagnostic') report.diagnostics.push(event.data.message);
    if (event.type === 'test:stdout') report.stdout.push(event.data.message);
    if (event.type === 'test:stderr') report.stderr.push(event.data.message);
  }
  yield JSON.stringify(report);
}
