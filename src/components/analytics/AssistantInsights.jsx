import { createElement, useEffect, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Coins, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';
import { formatINR } from '../../utils/formatters';

const periods = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
];

const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2026, index, 1))
);

export default function AssistantInsights({
  analytics,
  loading,
  rangeMode,
  setRangeMode,
  months,
  customMonth,
  setCustomMonth,
}) {
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const monthPickerRef = useRef(null);
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const selectedMonth = customMonth || currentMonth;
  const [selectedYear, selectedMonthNumber] = selectedMonth.split('-').map(Number);
  const periodLabel = periods.find((period) => period.id === rangeMode)?.label
    || (rangeMode === 'custom_month' ? customMonth : 'Selected Period');

  useEffect(() => {
    if (!selectedInsight) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') setSelectedInsight(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedInsight]);

  useEffect(() => {
    if (!isMonthPickerOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!monthPickerRef.current?.contains(event.target)) setIsMonthPickerOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsMonthPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isMonthPickerOpen]);

  const showInsight = (insight) => setSelectedInsight(insight);
  const entries = (analytics?.incomeCount || 0) + (analytics?.expenseCount || 0) + (analytics?.refreshmentCount || 0);
  const topCategory = analytics?.topCategories?.[0];
  const pendingCount = analytics?.pendingExpenses?.length || 0;

  const tiles = [
    {
      id: 'income',
      label: 'Income',
      value: formatINR(analytics?.totalIncome || 0),
      note: `${analytics?.incomeCount || 0} entries`,
      icon: TrendingUp,
      tone: 'green',
      detail: {
        title: `${periodLabel} income`,
        answer: `Total income recorded for ${periodLabel.toLowerCase()} is ${formatINR(analytics?.totalIncome || 0)}.`,
        rows: [`${analytics?.incomeCount || 0} income entries`, `Period: ${periodLabel}`],
      },
    },
    {
      id: 'expenses',
      label: 'Expenses',
      value: formatINR(analytics?.totalExpenses || 0),
      note: `${analytics?.expenseCount || 0} entries`,
      icon: TrendingDown,
      tone: 'red',
      detail: {
        title: `${periodLabel} expenses`,
        answer: `Total expenses recorded for ${periodLabel.toLowerCase()} are ${formatINR(analytics?.totalExpenses || 0)}.`,
        rows: [
          `${analytics?.expenseCount || 0} expense entries`,
          ...(analytics?.topCategories || []).slice(0, 3).map((item) => `${item.category}: ${formatINR(item.amount)} (${item.percentage}%)`),
        ],
      },
    },
    {
      id: 'balance',
      label: 'Net Balance',
      value: formatINR(analytics?.netBalance || 0),
      note: (analytics?.netBalance || 0) >= 0 ? 'Positive balance' : 'Expenses exceed income',
      icon: Wallet,
      tone: 'mint',
      detail: {
        title: `${periodLabel} net balance`,
        answer: `After expenses and refreshments, the net balance for ${periodLabel.toLowerCase()} is ${formatINR(analytics?.netBalance || 0)}.`,
        rows: [
          `Income: ${formatINR(analytics?.totalIncome || 0)}`,
          `Expenses: ${formatINR(analytics?.totalExpenses || 0)}`,
          `Refreshments: ${formatINR(analytics?.totalRefreshments || 0)}`,
        ],
      },
    },
    {
      id: 'pending',
      label: 'Pending Vouchers',
      value: String(pendingCount),
      note: `${formatINR(analytics?.pendingAmount || 0)} outstanding`,
      icon: Clock3,
      tone: 'amber',
      detail: {
        title: 'Pending vouchers',
        answer: pendingCount
          ? `${pendingCount} pending vouchers total ${formatINR(analytics?.pendingAmount || 0)} for ${periodLabel.toLowerCase()}.`
          : `There are no pending vouchers for ${periodLabel.toLowerCase()}.`,
        rows: (analytics?.pendingExpenses || []).slice(0, 6).map((item) => `Voucher #${item.voucherNo} · ${item.paidTo} · ${formatINR(item.amount)}`),
      },
    },
    {
      id: 'top-category',
      label: 'Top Expense Category',
      value: topCategory?.category || 'No expenses',
      note: topCategory ? formatINR(topCategory.amount) : 'Nothing recorded in this period',
      icon: Coins,
      tone: 'blue',
      detail: {
        title: 'Top expense category',
        answer: topCategory
          ? `${topCategory.category} is the highest expense category for ${periodLabel.toLowerCase()}, at ${formatINR(topCategory.amount)} (${topCategory.percentage}% of expenses).`
          : `No expenses are recorded for ${periodLabel.toLowerCase()}.`,
        rows: (analytics?.topCategories || []).slice(0, 5).map((item, index) => `${index + 1}. ${item.category}: ${formatINR(item.amount)} (${item.percentage}%)`),
      },
    },
    {
      id: 'entries',
      label: 'Total Entries',
      value: String(entries),
      note: 'Income, expenses and refreshments',
      icon: BarChart3,
      tone: 'purple',
      detail: {
        title: `${periodLabel} entries`,
        answer: `${entries} entries are recorded for ${periodLabel.toLowerCase()}.`,
        rows: [
          `Income: ${analytics?.incomeCount || 0}`,
          `Expenses: ${analytics?.expenseCount || 0}`,
          `Refreshments: ${analytics?.refreshmentCount || 0}`,
        ],
      },
    },
  ];

  return (
    <section className="assistant-insights">
      <div className="assistant-insights-toolbar">
        <div>
          <p className="assistant-eyebrow">ACCOUNT OVERVIEW</p>
          <h3>Quick insights</h3>
          <p className="assistant-insights-subtitle">Tap a card to see the figures behind it.</p>
        </div>
        <div className="assistant-period-picker" aria-label="Choose reporting period">
          {periods.map((period) => (
            <button
              type="button"
              key={period.id}
              className={rangeMode === period.id ? 'assistant-period-active' : ''}
              onClick={() => setRangeMode(period.id)}
            >
              {period.label}
            </button>
          ))}
          <div className="assistant-month-picker" ref={monthPickerRef}>
            <button
              type="button"
              className={`assistant-period-custom ${rangeMode === 'custom_month' ? 'assistant-period-active' : ''}`}
              aria-label="Choose month and year"
              aria-expanded={isMonthPickerOpen}
              onClick={() => {
                setPickerYear(rangeMode === 'custom_month' ? selectedYear : new Date().getFullYear());
                setIsMonthPickerOpen((open) => !open);
              }}
            >
              <CalendarDays size={14} />
              <span>{rangeMode === 'custom_month' ? `${monthNames[(selectedMonthNumber || 1) - 1]} ${selectedYear}` : 'Month / Year'}</span>
              <ChevronRight size={14} className={isMonthPickerOpen ? 'assistant-month-chevron-open' : ''} />
            </button>
            {isMonthPickerOpen && (
              <div className="assistant-month-popover" role="dialog" aria-label="Select a reporting month">
                <div className="assistant-month-year-row">
                  <button type="button" aria-label="Previous year" onClick={() => setPickerYear((year) => year - 1)}><ChevronLeft size={17} /></button>
                  <strong>{pickerYear}</strong>
                  <button type="button" aria-label="Next year" onClick={() => setPickerYear((year) => year + 1)}><ChevronRight size={17} /></button>
                </div>
                <div className="assistant-month-grid">
                  {monthNames.map((month, index) => {
                    const monthValue = `${pickerYear}-${String(index + 1).padStart(2, '0')}`;
                    const hasData = months.includes(monthValue);
                    const isSelected = rangeMode === 'custom_month' && selectedMonth === monthValue;
                    return (
                      <button
                        type="button"
                        key={month}
                        className={`${isSelected ? 'assistant-month-selected' : ''} ${hasData ? 'assistant-month-has-data' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setCustomMonth(monthValue);
                          setRangeMode('custom_month');
                          setIsMonthPickerOpen(false);
                        }}
                      >
                        {month.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
                <p>Choose a month · no day selection</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="assistant-insights-loading" role="status">Loading account insights…</div>
      ) : (
        <div className="assistant-insight-grid">
          {tiles.map(({ id, label, value, note, icon, tone, detail }) => (
            <button type="button" key={id} className={`assistant-insight-tile assistant-insight-${tone}`} onClick={() => showInsight(detail)}>
              <span className="assistant-insight-tile-top"><span>{label}</span>{createElement(icon, { size: 18 })}</span>
              <strong>{value}</strong>
              <span className="assistant-insight-note">{note}</span>
              <span className="assistant-insight-open">View details <ChevronRight size={14} /></span>
            </button>
          ))}
        </div>
      )}

      {selectedInsight && (
        <div className="assistant-insight-dialog-backdrop" onClick={(event) => event.target === event.currentTarget && setSelectedInsight(null)}>
          <section className="assistant-insight-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-insight-title">
            <div className="assistant-insight-dialog-heading">
              <span className="assistant-insight-dialog-icon"><Check size={18} /></span>
              <button type="button" aria-label="Close details" onClick={() => setSelectedInsight(null)}><X size={18} /></button>
            </div>
            <p className="assistant-eyebrow">{periodLabel.toUpperCase()} · INSIGHT</p>
            <h3 id="assistant-insight-title">{selectedInsight.title}</h3>
            <p className="assistant-insight-answer">{selectedInsight.answer}</p>
            {selectedInsight.rows.length > 0 && (
              <ul className="assistant-insight-detail-list">
                {selectedInsight.rows.map((row) => <li key={row}>{row}</li>)}
              </ul>
            )}
            <button type="button" className="assistant-insight-done" onClick={() => setSelectedInsight(null)}>Done</button>
          </section>
        </div>
      )}
    </section>
  );
}
