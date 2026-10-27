export default async function* previewTestReporter(events) {
  const report = { passed: [], failed: [], diagnostics: [], stdout: [] };
  for await (const event of events) {
    if (event.type === 'test:pass') report.passed.push(event.data.name);
    if (event.type === 'test:fail') report.failed.push(event.data.name);
    if (event.type === 'test:diagnostic') report.diagnostics.push(event.data.message);
    if (event.type === 'test:stdout') report.stdout.push(event.data.message);
  }
  yield JSON.stringify(report);
}
