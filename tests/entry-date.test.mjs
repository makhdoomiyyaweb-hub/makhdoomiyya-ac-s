import test from 'node:test';
import assert from 'node:assert/strict';
import { readEntryDate, writeEntryDate, validEntryDate } from '../src/utils/entryDate.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('entry dates are isolated by form, event and transaction type', () => {
  const storage = memoryStorage();
  writeEntryDate('income', '2026-06-01', storage);
  writeEntryDate('expense', '2026-06-02', storage);
  writeEntryDate('event:a:income', '2026-06-03', storage);
  assert.equal(readEntryDate('income', '2026-11-05', storage), '2026-06-01');
  assert.equal(readEntryDate('expense', '2026-11-05', storage), '2026-06-02');
  assert.equal(readEntryDate('event:a:income', '2026-11-05', storage), '2026-06-03');
  assert.equal(readEntryDate('event:a:expense', '2026-11-05', storage), '2026-11-05');
  assert.equal(readEntryDate('event:b:income', '2026-11-05', storage), '2026-11-05');
});

test('invalid stored dates fall back and invalid dates are not saved', () => {
  const storage = memoryStorage();
  for (const value of ['2026-02-30', '2026-6-1', 'bad']) assert.equal(validEntryDate(value), false);
  assert.equal(validEntryDate('2024-02-29'), true);
  writeEntryDate('income', '2026-02-30', storage);
  assert.equal(readEntryDate('income', '2026-11-05', storage), '2026-11-05');
});

test('storage failures do not block form date entry', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readEntryDate('income', '2026-11-05', blocked), '2026-11-05');
  assert.doesNotThrow(() => writeEntryDate('income', '2026-06-01', blocked));
});
