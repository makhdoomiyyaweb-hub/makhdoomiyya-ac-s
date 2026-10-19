import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRecord, sameRecord } from '../src/utils/recordFilters.js';

const row = { id: 'one', date: '2026-06-15', digitalReceiptNo: 'R-00123', category: 'FOOD', payerName: 'Abdul Rahman', item: 'Meals', amount: 250, notes: 'ജൂൺ ചെലവ്' };
test('partial search covers identifiers, category, names, items, amounts and Malayalam', () => {
  for (const term of ['0012', 'food', 'rahm', 'meal', '250', 'ജൂൺ', '  FOOD   rahman  ']) assert.equal(matchesRecord(row, term), true, term);
  assert.equal(matchesRecord(row, 'salary'), false);
});
test('exact transaction day and search combine; empty dates do not enter date filters', () => {
  const range = { start: '2026-06-15', end: '2026-06-15' };
  assert.equal(matchesRecord(row, 'food', range), true);
  assert.equal(matchesRecord(row, 'salary', range), false);
  assert.equal(matchesRecord({ ...row, date: '2026-06-16' }, '', range), false);
  assert.equal(matchesRecord({ ...row, date: '' }, '', range), false);
  assert.equal(matchesRecord(row), true);
});
test('stale edits detect financial, ownership and deletion changes, ignoring sync flags only', () => {
  assert.equal(sameRecord(row, { ...row, synced: true, sync_status: 'synced' }), true);
  for (const change of [{ amount: 300 }, { event_id: 'other' }, { is_deleted: true }]) assert.equal(sameRecord(row, { ...row, ...change }), false);
  assert.equal(sameRecord(row, undefined), false);
});
