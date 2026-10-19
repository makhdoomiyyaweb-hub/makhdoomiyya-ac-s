import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Input from './Input';
import Select from './Select';
import DatePicker from './DatePicker';
import Button from './Button';
import { EDIT_FIELDS, saveTransactionEdit, validateEdit } from '../../utils/editTransaction';
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, REFRESHMENT_ITEMS, PAYMENT_MODES } from '../../constants/categories';
import toast from 'react-hot-toast';

const LABELS = { date: 'Date', category: 'Category', payerName: 'Payer Name', paidTo: 'Paid To', address: 'Address', contactNo: 'Contact No', manualReceiptNo: 'Manual Receipt No', manualVoucherNo: 'Manual Voucher No', amount: 'Amount (₹)', amountInWords: 'Amount in Words', paymentMode: 'Payment Mode', paymentStatus: 'Payment Status', approvedBy: 'Approved By', being: 'Being (Purpose)', remarks: 'Remarks', item: 'Item', quantity: 'Quantity', notes: 'Notes' };

export default function EditTransactionModal({ record, table, onClose, categories = [] }) {
  const isIncome = table === 'income' || record.type === 'income';
  const [values, setValues] = useState(() => ({ ...record, paymentStatus: record.paymentStatus || (isIncome ? 'Received' : 'Paid') }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const busy = useRef(false);
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('button, input, select')?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus?.(); };
  }, []);
  const close = () => { if (!busy.current) onClose(); };
  const change = e => { setValues(prev => ({ ...prev, [e.target.name]: e.target.value })); setErrors(prev => ({ ...prev, [e.target.name]: undefined })); };
  const submit = async e => {
    e.preventDefault();
    if (busy.current) return;
    const validation = validateEdit(table, values, record.type);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    busy.current = true;
    setSaving(true);
    setFailure('');
    try {
      const saved = await saveTransactionEdit(table, record, values);
      toast.success(saved?.synced ? 'Changes saved and synced' : 'Changes saved on this device. Cloud sync pending.');
      onClose();
    } catch (error) { setFailure(error.message || 'Unable to save changes'); }
    finally { busy.current = false; setSaving(false); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3" onKeyDown={e => { if (e.key === 'Escape') close(); }}>
      <div className="absolute inset-0 bg-black/60" onClick={close} />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-transaction-title" onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(el => el.getClientRects().length && !el.closest('fieldset:disabled'));
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }} className="relative w-full max-w-2xl max-h-[90dvh] flex flex-col bg-white rounded-lg shadow-xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 id="edit-transaction-title" className="font-semibold text-text">Edit {isIncome ? 'Income' : table === 'expenses' || record.type === 'expense' ? 'Expense' : 'Refreshment'}</h2>
          <Button variant="ghost" disabled={saving} onClick={close} aria-label="Close edit">✕</Button>
        </div>
        <form onSubmit={submit} className="overflow-y-auto p-4 space-y-4">
          <fieldset disabled={saving} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EDIT_FIELDS[table].filter(key => table !== 'event_transactions' || !['payerName', 'paidTo'].includes(key) || key === (record.type === 'income' ? 'payerName' : 'paidTo')).map(key => {
              const props = { name: key, label: LABELS[key], value: values[key] ?? '', onChange: change, error: errors[key] };
              let options;
              if (key === 'category') options = table === 'income' ? INCOME_CATEGORIES : table === 'expenses' ? EXPENSE_CATEGORIES : categories;
              if (key === 'item') options = REFRESHMENT_ITEMS;
              if (key === 'paymentMode') options = PAYMENT_MODES;
              if (key === 'paymentStatus') options = isIncome ? ['Received', 'Pending'] : ['Paid', 'Pending'];
              if (options) return <Select {...props} key={key} options={[...new Set([...options, record[key]].filter(Boolean))]} />;
              if (key === 'date') return <DatePicker {...props} key={key} />;
              return <Input {...props} key={key} type={['amount', 'quantity'].includes(key) ? 'number' : 'text'} min={key === 'amount' ? '0.01' : key === 'quantity' ? '1' : undefined} step={key === 'amount' ? 'any' : undefined} />;
            })}
          </fieldset>
          {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button variant="secondary" disabled={saving} onClick={close}>Cancel</Button>
            <Button type="submit" loading={saving}>Save Changes</Button>
          </div>
        </form>
      </section>
    </div>, document.body
  );
}
