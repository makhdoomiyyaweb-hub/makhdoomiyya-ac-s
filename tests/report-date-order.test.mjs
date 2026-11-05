import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/Reports.jsx', import.meta.url), 'utf8');
for (const name of ['dataToPrint', 'latestData']) {
  test(`${name} is sorted in ascending transaction-date order`, () => {
    const match = source.match(new RegExp(`${name}\\.sort\\(([^;]+)\\);`));
    assert.ok(match, `Expected report sort for ${name}`);
    const compare = Function(`return (${match[1]})`)();
    const records = [{ date: '2026-06-03' }, { date: '2026-06-01' }, { date: '2026-06-02' }];
    assert.deepEqual(records.toSorted(compare).map(record => record.date), ['2026-06-01', '2026-06-02', '2026-06-03']);
    assert.equal(records.length, 3, 'sorting does not create missing-day rows');
  });
}
