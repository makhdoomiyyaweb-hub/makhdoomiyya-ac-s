import db from './db';
import { validators } from './validators';
import { DONATION_CATEGORIES } from '../constants/categories';
import { amountToWords } from './amountToWords';
import { sameRecord } from './recordFilters';
import { syncPendingRecords } from '../sync/engine';

export const EDIT_FIELDS = {
  income: ['date', 'category', 'payerName', 'address', 'contactNo', 'manualReceiptNo', 'amount', 'amountInWords', 'paymentStatus'],
  expenses: ['date', 'category', 'paidTo', 'being', 'manualVoucherNo', 'amount', 'amountInWords', 'paymentMode', 'paymentStatus', 'approvedBy', 'remarks'],
  refreshments: ['date', 'item', 'quantity', 'amount', 'notes', 'paymentStatus'],
  event_transactions: ['date', 'category', 'payerName', 'paidTo', 'amount', 'notes', 'paymentStatus'],
};

export function validateEdit(table, values, type) {
  const key = { income: 'income', expenses: 'expense', refreshments: 'refreshment' }[table];
  const errors = key ? validators[key](values) : validators.income(values);
  if (!Number.isFinite(Number(values.amount)) || Number(values.amount) <= 0) errors.amount = 'Valid amount required';
  if (table === 'refreshments' && !Number.isFinite(Number(values.quantity))) errors.quantity = 'Valid quantity required';
  const statuses = (type === 'income' || table === 'income') ? ['Received', 'Pending'] : ['Paid', 'Pending', 'Unpaid'];
  if (!statuses.includes(values.paymentStatus)) errors.paymentStatus = 'Select a valid payment status';
  const parsedDate = new Date(values.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date || '') || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== values.date) errors.date = 'Valid date required';
  return errors;
}

export async function saveTransactionEdit(table, original, values) {
  if (!EDIT_FIELDS[table]) throw new Error('Unsupported transaction type');
  if (Object.keys(validateEdit(table, values, original.type)).length) throw new Error('Please check the form fields');
  const updates = Object.fromEntries(EDIT_FIELDS[table].filter(key => key in values).map(key => [key, values[key]]));
  updates.amount = Number(values.amount);
  if (table === 'refreshments') updates.quantity = Number(values.quantity);
  if ('amountInWords' in updates && Number(original.amount) !== updates.amount) updates.amountInWords = amountToWords(updates.amount);
  if (table === 'income') updates.donationType = DONATION_CATEGORIES.includes(updates.category) ? 'Donation' : updates.category;

  await db.transaction('rw', db[table], async () => {
    const current = await db[table].get(original.id);
    if (!current || current.is_deleted) throw new Error('This record was deleted. Close and refresh the list.');
    if (!sameRecord(original, current)) throw new Error('This record changed. Close and reopen Edit to load its latest values.');
    // Preserve identity, numbering, event ownership and creation timestamp. Never insert from an edit.
    await db[table].update(original.id, { ...updates, synced: false, sync_status: 'pending',
      sync_operation: current.sync_operation === 'create' ? 'create' : 'update' });
  });
  // Both the old and the new month may have changed when a date is edited.
  try {
    const months = new Set([original.date?.slice(0, 7), updates.date?.slice(0, 7)]);
    const loaded = JSON.parse(localStorage.getItem('dawa_loaded_months') || '[]');
    localStorage.setItem('dawa_loaded_months', JSON.stringify(loaded.filter(entry => !months.has(typeof entry === 'string' ? entry : entry.month))));
  } catch { /* Cache invalidation must not undo a saved edit. */ }
  try { await syncPendingRecords(); } catch { /* The local edit remains queued for retry. */ }
  return db[table].get(original.id);
}
