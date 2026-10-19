const SEARCH_FIELDS = ['date', 'digitalReceiptNo', 'manualReceiptNo', 'voucherNo',
  'manualVoucherNo', 'category', 'donationType', 'payerName', 'paidTo', 'address',
  'contactNo', 'being', 'item', 'quantity', 'notes', 'remarks', 'amount',
  'paymentMode', 'paymentStatus', 'approvedBy', 'type', 'name', 'description'];

export function matchesRecord(record, query = '', range = null) {
  const date = String(record.date || '').slice(0, 10);
  if (range?.start && (!date || date < range.start)) return false;
  if (range?.end && (!date || date > range.end)) return false;
  const text = SEARCH_FIELDS.map(key => String(record[key] ?? '')).join(' ').normalize('NFKC').toLocaleLowerCase();
  return query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).every(word => text.includes(word));
}

export function sameRecord(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => key === 'synced' || key === 'sync_status' || a[key] === b[key]);
}
