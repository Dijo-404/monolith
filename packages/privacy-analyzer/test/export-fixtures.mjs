import { readFileSync, writeFileSync } from 'node:fs';
import { exportPrivacyReport } from '@monolith/privacy-analyzer';

const directory = new URL('../../../tests/fixtures/privacy/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('leak-repair.json', directory), 'utf8'));
if (fixture.evidence !== 'SIMULATED' || fixture.cases.length !== 2) {
  throw new Error('Expected the fixed two-case SIMULATED fixture.');
}
const paths = ['leak.report-simulated.json', 'repair.report-simulated.json'];
for (const [index, entry] of fixture.cases.entries()) {
  if (entry.input.evidence !== 'SIMULATED') throw new Error('Fixture input must remain SIMULATED.');
  const result = exportPrivacyReport(entry.input, fixture.scope);
  if (!result.ok) throw new Error('Synthetic fixture analysis failed.');
  const report = JSON.parse(result.value);
  if (report.evidence !== 'SIMULATED') throw new Error('Fixture export must remain SIMULATED.');
  writeFileSync(new URL(paths[index], directory), result.value);
}
process.stdout.write('Exported SIMULATED leak and repair reports.\n');
