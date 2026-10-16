import db from './db';

/**
 * analyticsEngine.js
 *
 * LOCAL-FIRST DEFENSIVE ANALYTICS ENGINE
 * • Reads exclusively from client-side Dexie IndexedDB (DawaTrustDB).
 * • ZERO calls or network requests to Supabase.
 * • Completely defensive: catches errors and returns safe fallbacks so the app NEVER crashes.
 * • Pure read-only: never modifies, inserts, or deletes records.
 */

export async function getAvailableMonths() {
  try {
    const monthSet = new Set();
    const collectMonths = async (table) => table.orderBy('date').filter((row) => !row.is_deleted).each((row) => {
      if (row.date && row.date.length >= 7) monthSet.add(row.date.substring(0, 7));
    });
    await Promise.all([collectMonths(db.income), collectMonths(db.expenses), collectMonths(db.refreshments)]);

    return Array.from(monthSet).sort().reverse();
  } catch (err) {
    console.warn('[AnalyticsEngine] Failed to load available months:', err);
    return [];
  }
}

/**
 * Helper to build matching function based on range filter
 */
function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDateRange(rangeMode, customMonth) {
  const today = new Date();
  if (rangeMode === 'today') {
    const todayStr = formatLocalDate(today);
    return { start: todayStr, end: todayStr };
  }

  if (rangeMode === 'this_week') {
    const monday = new Date(today);
    const day = monday.getDay();
    monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return { start: formatLocalDate(monday), end: formatLocalDate(sunday) };
  }

  if (rangeMode === 'this_month') {
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    return { start: `${month}-01`, end: `${month}-31` };
  }

  if (rangeMode === 'custom_month' && /^\d{4}-\d{2}$/.test(customMonth)) {
    const [year, month] = customMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { start: `${customMonth}-01`, end: `${customMonth}-${String(lastDay).padStart(2, '0')}` };
  }

  return null;
}

async function getRowsForRange(table, dateRange) {
  const query = dateRange
    ? table.where('date').between(dateRange.start, dateRange.end, true, true)
    : table.toCollection();
  return query.filter((row) => !row.is_deleted).toArray();
}

export async function getPeriodAnalytics(rangeMode = 'this_month', customMonth = '') {
  const safeFallback = {
    rangeMode,
    customMonth,
    periodLabel: 'ഈ മാസം',
    totalIncome: 0,
    incomeCount: 0,
    totalExpenses: 0,
    expenseCount: 0,
    totalRefreshments: 0,
    refreshmentCount: 0,
    netBalance: 0,
    topCategories: [],
    pendingExpenses: [],
    pendingAmount: 0,
    comparison: null,
    highExpenses: [],
    error: false
  };

  try {
    const dateRange = getDateRange(rangeMode, customMonth);
    const comparisonMonth = (rangeMode === 'custom_month' && customMonth)
      || (rangeMode === 'this_month' ? formatLocalDate(new Date()).slice(0, 7) : '');
    let previousRange = null;
    let previousMonthStr = '';
    if (comparisonMonth && /^\d{4}-\d{2}$/.test(comparisonMonth)) {
      const [year, month] = comparisonMonth.split('-').map(Number);
      const previousDate = new Date(year, month - 2, 1);
      previousMonthStr = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
      previousRange = { start: `${previousMonthStr}-01`, end: `${previousMonthStr}-${String(new Date(previousDate.getFullYear(), previousDate.getMonth() + 1, 0).getDate()).padStart(2, '0')}` };
    }

    const [incomeRows, expenseRows, refRows, previousIncomeRows, previousExpenseRows] = await Promise.all([
      getRowsForRange(db.income, dateRange),
      getRowsForRange(db.expenses, dateRange),
      getRowsForRange(db.refreshments, dateRange),
      previousRange ? getRowsForRange(db.income, previousRange) : Promise.resolve([]),
      previousRange ? getRowsForRange(db.expenses, previousRange) : Promise.resolve([])
    ]);

    const totalIncome = incomeRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const totalExpenses = expenseRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const totalRefreshments = refRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const netBalance = totalIncome - totalExpenses - totalRefreshments;

    // Top Categories
    const categoryTotals = {};
    expenseRows.forEach(r => {
      const cat = (r.category || 'OTHER').toUpperCase().trim();
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(r.amount) || 0);
    });

    const topCategories = Object.entries(categoryTotals)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Pending Vouchers
    const pendingExpenses = expenseRows
      .filter(r => (r.paymentStatus || '').toLowerCase() === 'pending')
      .map(r => ({
        id: r.id,
        voucherNo: r.manualVoucherNo || r.voucherNo || '-',
        paidTo: r.paidTo || r.being || 'Unknown',
        being: r.being || '',
        amount: Number(r.amount) || 0,
        date: r.date || ''
      }));
    const pendingAmount = pendingExpenses.reduce((sum, r) => sum + r.amount, 0);

    // High single transactions
    const highExpenses = [...expenseRows]
      .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
      .slice(0, 3)
      .map(r => ({
        date: r.date,
        category: r.category,
        paidTo: r.paidTo || r.being || 'Expense',
        amount: Number(r.amount) || 0,
        voucherNo: r.manualVoucherNo || r.voucherNo || ''
      }));

    // Month comparison (when month mode is selected)
    let comparison = null;
    if (previousMonthStr) {
      const prevExpenses = previousExpenseRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const prevIncome = previousIncomeRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

      const expDiff = totalExpenses - prevExpenses;
      const expPercent = prevExpenses > 0 ? Math.round((expDiff / prevExpenses) * 100) : 0;

      comparison = {
        prevMonth: previousMonthStr,
        prevExpenses,
        prevIncome,
        expenseDiff: expDiff,
        expensePercent: expPercent
      };
    }

    const labels = {
      today: 'ഇന്നത്തെ കണക്കുകൾ (Today)',
      this_week: 'ഈ ആഴ്ചയിലെ കണക്കുകൾ (This Week)',
      this_month: 'ഈ മാസത്തെ കണക്കുകൾ (This Month)',
      custom_month: `${customMonth} മാസത്തെ കണക്കുകൾ`,
      all: 'മൊത്തം കണക്കുകൾ (All-Time)'
    };

    return {
      rangeMode,
      customMonth,
      periodLabel: labels[rangeMode] || customMonth,
      totalIncome,
      incomeCount: incomeRows.length,
      totalExpenses,
      expenseCount: expenseRows.length,
      totalRefreshments,
      refreshmentCount: refRows.length,
      netBalance,
      topCategories,
      pendingExpenses,
      pendingAmount,
      comparison,
      highExpenses,
      error: false
    };
  } catch (err) {
    console.warn('[AnalyticsEngine] Error computing analytics:', err);
    return { ...safeFallback, error: true };
  }
}

/**
 * Creates clean, aggregated context for AI. Keep exact local calculations intact;
 * only omit sections that are unrelated to the current question.
 */
export function getSanitizedContext(analytics) {
  if (!analytics || analytics.error) return 'ഡാറ്റ ലഭ്യമല്ല.';

  const topCats = analytics.topCategories
    .map(c => `- ${c.category}: ₹${c.amount.toLocaleString('en-IN')} (${c.percentage}%)`)
    .join('\n');

  const pendingInfo = analytics.pendingExpenses.length > 0
    ? `പെൻഡിങ് വൗച്ചറുകൾ: ${analytics.pendingExpenses.length} എണ്ണം, ആകെ തുക: ₹${analytics.pendingAmount.toLocaleString('en-IN')}`
    : 'പെൻഡിങ് പേയ്‌മെന്റുകൾ ഒന്നുമില്ല.';

  let compInfo = '';
  if (analytics.comparison && analytics.comparison.prevExpenses > 0) {
    const dir = analytics.comparison.expenseDiff >= 0 ? 'കൂടി' : 'കുറഞ്ഞു';
    compInfo = `കഴിഞ്ഞ മാസവുമായുള്ള (${analytics.comparison.prevMonth}) താരതമ്യം: ചെലവിൽ ${Math.abs(analytics.comparison.expensePercent)}% വ്യത്യാസം (${dir}).`;
  }

  return `
അക്കൗണ്ട് സംഗ്രഹം (${analytics.periodLabel}):
- ആകെ വരവ് (Income): ₹${analytics.totalIncome.toLocaleString('en-IN')} (${analytics.incomeCount} എൻട്രികൾ)
- ആകെ ചിലവ് (Expense): ₹${analytics.totalExpenses.toLocaleString('en-IN')} (${analytics.expenseCount} എൻട്രികൾ)
- നെറ്റ് ബാലൻസ് (Net Balance): ₹${analytics.netBalance.toLocaleString('en-IN')} ${analytics.netBalance >= 0 ? '(നീക്കിയിരിപ്പ്)' : '(കമ്മി/ചിലവ് കൂടുതൽ)'}
- പ്രധാന ചിലവ് കാറ്റഗറികൾ (Top Expenses):
${topCats || 'ഡാറ്റയില്ല'}
- ${pendingInfo}
${compInfo}
`.trim();
}

/**
 * Malayalam to English phonetic root map for accounting, payees, and item keywords
 */
const PHONETIC_ROOT_MAP = {
  'ഹബീബ': ['habeeb', 'habib'],
  'ഇറല': ['ilal', 'iral'],
  'ഇലല': ['ilal', 'iral'],
  'ഷിറാസ': ['shiras', 'shiraz'],
  'ഫുഡ': ['food'],
  'ഭക്ഷണ': ['food'],
  'ഫിഷ': ['fish'],
  'മീന': ['fish'],
  'ഇന്നോവ': ['innova'],
  'വാടക': ['rent'],
  'യാത്ര': ['travel'],
  'പ്രിന്റ': ['print', 'dtp'],
  'ഡിടിപ': ['dtp'],
  'ശമ്പള': ['salary'],
  'വൈദ്യുതി': ['electricity', 'current'],
  'ഇന്ധന': ['fuel'],
  'ഡീസല': ['fuel', 'diesel'],
  'പെട്രോള': ['fuel', 'petrol'],
  'സൗണ്ട': ['sound', 'mic'],
  'മൈക': ['mic', 'mike', 'sound'],
  'പെയിന്റ': ['paint', 'painting']
};

function stripMalayalamSigns(str) {
  if (!str) return '';
  return str.replace(/\u0D4D/g, '');
}

function parseDateFilter(query) {
  if (!query) return null;
  let text = query.trim();

  const today = new Date();
  const formatYMD = formatLocalDate;

  if (text.includes('ഇന്ന്') || text.toLowerCase().includes('today')) {
    return { type: 'exact_day', dateStr: formatYMD(today), label: 'ഇന്ന് (' + formatYMD(today) + ')' };
  }
  if (text.includes('ഇന്നലെ') || text.toLowerCase().includes('yesterday')) {
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    return { type: 'exact_day', dateStr: formatYMD(yest), label: 'ഇന്നലെ (' + formatYMD(yest) + ')' };
  }

  let year = '2026';
  const yMatch = text.match(/\b(202\d)\b/);
  if (yMatch) {
    year = yMatch[1];
    text = text.replace(yMatch[1], ' ');
  }

  // Normalize: separate letters and numbers (e.g. "september20" -> "september 20", "20th" -> "20 th", "20thile" -> "20 thile", "സെപ്റ്റംബർ20" -> "സെപ്റ്റംബർ 20")
  text = text.replace(/([\p{L}\p{M}]+)(\d+)/gu, '$1 $2')
             .replace(/(\d+)([\p{L}\p{M}]+)/gu, '$1 $2');

  const malMonths = {
    'ജനുവരി': '01', 'ഫെബ്രുവരി': '02', 'മാർച്ച്': '03', 'ഏപ്രിൽ': '04',
    'മെയ്': '05', 'ജൂൺ': '06', 'ജൂലൈ': '07', 'ആഗസ്റ്റ്': '08',
    'ഓഗസ്റ്റ്': '08', 'സെപ്റ്റംബർ': '09', 'ഒക്ടോബർ': '10', 'നവംബർ': '11', 'ഡിസംബർ': '12',
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
    'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  // Sort by name length descending so full names match before 3-letter abbreviations
  const sortedMonths = Object.entries(malMonths).sort((a, b) => b[0].length - a[0].length);

  for (const [mName, mNum] of sortedMonths) {
    if (text.toLowerCase().includes(mName)) {
      const dMatch = text.match(/\b([1-9]|[12]\d|3[01])\b/);
      if (dMatch) {
        const day = dMatch[1].padStart(2, '0');
        return { type: 'exact_day', dateStr: `${year}-${mNum}-${day}`, label: `${year}-${mNum}-${day}` };
      }
      return { type: 'month', monthStr: `${year}-${mNum}`, label: `${year}-${mNum}` };
    }
  }

  const isoMatch = query.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return {
      type: 'exact_day',
      dateStr: `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`,
      label: `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`
    };
  }

  const dmyMatch = query.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    return {
      type: 'exact_day',
      dateStr: `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`,
      label: `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`
    };
  }

  // DD/MM or DD-MM format without year (e.g., 20/09 or 20-09)
  const dmMatch = text.match(/\b([1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])\b/);
  if (dmMatch) {
    const day = dmMatch[1].padStart(2, '0');
    const month = dmMatch[2].padStart(2, '0');
    return { type: 'exact_day', dateStr: `${year}-${month}-${day}`, label: `${year}-${month}-${day}` };
  }

  return null;
}

function extractEntityKeywords(query) {
  if (!query) return [];
  const searchTerms = new Set();
  const queryLower = query.toLowerCase();
  const strippedQuery = stripMalayalamSigns(query);

  for (const [root, engArr] of Object.entries(PHONETIC_ROOT_MAP)) {
    if (strippedQuery.includes(root) || queryLower.includes(root)) {
      searchTerms.add(root);
      engArr.forEach(e => searchTerms.add(e));
    }
  }

  const engWords = query.match(/[a-zA-Z]{3,}/g) || [];
  engWords.forEach(w => searchTerms.add(w.toLowerCase()));

  const stopWords = new Set([
    'എന്ന്', 'പറഞ്ഞ', 'ചെലവ്', 'ചിലവ്', 'വിവരം', 'വിവരങ്ങൾ', 'ഡീറ്റെയിൽസ്',
    'കണക്ക്', 'കണക്കുകൾ', 'എത്ര', 'ആണ്', 'ഉള്ളത്', 'വേണം', 'പറയുക', 'നൽകുക',
    'വരുമാനം', 'മാസം', 'ദിവസം', 'തീയതി', 'കാര്യം', 'ചെയ്യുക', 'നോക്കുക', 'കാണിക്കുക'
  ]);
  const malWords = query.match(/[\u0D00-\u0D7F]{3,}/g) || [];
  malWords.forEach(w => {
    if (!stopWords.has(w)) {
      searchTerms.add(w);
    }
  });

  return Array.from(searchTerms);
}

/**
 * Builds an enriched Algorithmic Context tailored specifically to the user's question.
 * Runs deterministic search algorithms across IndexedDB before connecting to the AI:
 * 1. Tool A: Exact Date & Period Matcher
 * 2. Tool B: Entity / Person / Payee / Item Matcher
 * 3. Tool C: Special Events & Event Transactions Matcher
 * 4. Tool D: Category Breakdown Matcher
 * 5. Tool E: Macro Multi-Month Master Overview
 */
export async function getFullMasterContext(userQuestion = '') {
  try {
    const [allIncome, allExpenses, allRefreshments, allEvents, allEventTxs] = await Promise.all([
      db.income.filter(r => !r.is_deleted).toArray(),
      db.expenses.filter(r => !r.is_deleted).toArray(),
      db.refreshments.filter(r => !r.is_deleted).toArray(),
      db.events ? db.events.filter(r => !r.is_deleted).toArray().catch(() => []) : Promise.resolve([]),
      db.event_transactions ? db.event_transactions.filter(r => !r.is_deleted).toArray().catch(() => []) : Promise.resolve([])
    ]);

    let algorithmicSections = [];

    // --- TOOL 1: DATE & PERIOD SEARCH TOOL ---
    const dateFilter = parseDateFilter(userQuestion);
    if (dateFilter) {
      if (dateFilter.type === 'exact_day') {
        const targetDay = dateFilter.dateStr;
        const dayExp = allExpenses.filter(r => (r.date || '').startsWith(targetDay));
        const dayInc = allIncome.filter(r => (r.date || '').startsWith(targetDay));
        const dayRef = allRefreshments.filter(r => (r.date || '').startsWith(targetDay));

        const expSum = dayExp.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const incSum = dayInc.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const refSum = dayRef.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const dayNet = incSum - expSum - refSum;

        let dayReport = `
[തീയതി തിരിച്ചുള്ള കൃത്യമായ സാമ്പത്തിക വിവരങ്ങൾ (EXACT DATE REPORT FOR ${dateFilter.label})]:
• തിരഞ്ഞ തീയതി: ${dateFilter.label}
• ആകെ ചിലവ്: ₹${expSum.toLocaleString('en-IN')} (${dayExp.length} വൗച്ചറുകൾ)
• ആകെ വരവ്: ₹${incSum.toLocaleString('en-IN')} (${dayInc.length} എൻട്രികൾ)
• നെറ്റ് ബാലൻസ്: ₹${dayNet.toLocaleString('en-IN')} (${dayNet >= 0 ? 'നീക്കിയിരിപ്പ്' : 'കമ്മി'})
`;

        if (dayExp.length > 0) {
          dayReport += `\n• ഈ ദിവസത്തെ ചെലവുകളുടെ വിശദാംശങ്ങൾ:\n`;
          dayExp.forEach((e, idx) => {
            const vNo = e.manualVoucherNo || e.voucherNo || '-';
            const paid = e.paidTo || 'Unknown';
            const bg = e.being ? ` | വിവരണം: ${e.being}` : '';
            dayReport += `  ${idx + 1}. വൗച്ചർ #${vNo} | വിഭാഗം: ${e.category || 'OTHER'} | പണം നൽകിയത്: ${paid}${bg} | തുക: ₹${(Number(e.amount) || 0).toLocaleString('en-IN')} (Status: ${e.paymentStatus || 'Paid'})\n`;
          });
        } else {
          dayReport += `• ഈ തീയതിയിൽ സിസ്റ്റത്തിൽ ചെലവുകൾ ഒന്നും രേഖപ്പെടുത്തിയിട്ടില്ല.\n`;
        }

        if (dayInc.length > 0) {
          dayReport += `\n• ഈ ദിവസത്തെ വരവുകളുടെ വിശദാംശങ്ങൾ:\n`;
          dayInc.forEach((inc, idx) => {
            const rNo = inc.manualReceiptNo || inc.digitalReceiptNo || '-';
            dayReport += `  ${idx + 1}. രസീത് #${rNo} | പേര്: ${inc.payerName || 'Anonymous'} | വിഭാഗം: ${inc.category || 'DONATION'} | തുക: ₹${(Number(inc.amount) || 0).toLocaleString('en-IN')}\n`;
          });
        }

        algorithmicSections.push(dayReport.trim());
      } else if (dateFilter.type === 'month') {
        const targetMonth = dateFilter.monthStr;
        const mExp = allExpenses.filter(r => (r.date || '').startsWith(targetMonth));
        const mInc = allIncome.filter(r => (r.date || '').startsWith(targetMonth));
        const mRef = allRefreshments.filter(r => (r.date || '').startsWith(targetMonth));
        const expSum = mExp.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const incSum = mInc.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const refSum = mRef.reduce((s, r) => s + (Number(r.amount) || 0), 0);

        let monthReport = `
[മാസ തിരിച്ചുള്ള കൃത്യമായ സാമ്പത്തിക വിവരങ്ങൾ (EXACT MONTH REPORT FOR ${dateFilter.label})]:
• മാസം: ${dateFilter.label}
• ആകെ ചിലവ്: ₹${expSum.toLocaleString('en-IN')} (${mExp.length} വൗച്ചറുകൾ)
• ആകെ വരവ്: ₹${incSum.toLocaleString('en-IN')} (${mInc.length} എൻട്രികൾ)
• റിഫ്രഷ്മെന്റ്: ₹${refSum.toLocaleString('en-IN')} (${mRef.length} എൻട്രികൾ)
• നെറ്റ് ബാലൻസ്: ₹${(incSum - expSum - refSum).toLocaleString('en-IN')}
`;
        algorithmicSections.push(monthReport.trim());
      }
    }

    // --- TOOL 2: ENTITY, PAYEE, ITEM & DESCRIPTION SEARCH TOOL ---
    const keywords = extractEntityKeywords(userQuestion);
    if (keywords.length > 0) {
      const findMatches = (records, fields) => records
        .map((record) => {
          const haystack = fields.map((field) => record[field] || '').join(' ').toLowerCase();
          const score = keywords.reduce((total, term) => total + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
          return { record, score };
        })
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score);

      const matchedExpenses = findMatches(allExpenses, ['paidTo', 'being', 'category', 'remarks', 'manualVoucherNo', 'voucherNo']);
      const matchedIncome = findMatches(allIncome, ['payerName', 'category', 'notes', 'manualReceiptNo', 'digitalReceiptNo']);
      const matchedRefreshments = findMatches(allRefreshments, ['paidTo', 'being', 'description', 'category', 'notes', 'voucherNo']);
      const matchesTotal = [...matchedExpenses, ...matchedIncome, ...matchedRefreshments];

      if (matchesTotal.length > 0) {
        let entityReport = `
[പേര് / ഇനം പരിശോധിച്ചു കണ്ടെത്തിയ രേഖകൾ (LOCAL SEARCH RESULTS)]:
• തിരഞ്ഞ പദങ്ങൾ: ${keywords.join(', ')}
• എല്ലാ വിഭാഗങ്ങളിലുമായി കണ്ടെത്തിയ എൻട്രികൾ: ${matchesTotal.length}
`;
        const appendMatches = (label, matches, formatRow) => {
          if (matches.length === 0) return '';
          const amount = matches.reduce((sum, match) => sum + (Number(match.record.amount) || 0), 0);
          return `\n[${label}: ${matches.length} എൻട്രികൾ; ആകെ ₹${amount.toLocaleString('en-IN')}]\n`
            + matches.map((match, index) => `${index + 1}. ${formatRow(match.record)}`).join('\n') + '\n';
        };
        entityReport += appendMatches('ചെലവുകൾ', matchedExpenses, (record) => {
          const voucher = record.manualVoucherNo || record.voucherNo || '-';
          return `തീയതി: ${record.date || '-'} | വൗച്ചർ #${voucher} | പണം നൽകിയത്: ${record.paidTo || '-'} | വിവരണം: ${record.being || '-'} | വിഭാഗം: ${record.category || '-'} | തുക: ₹${(Number(record.amount) || 0).toLocaleString('en-IN')} | നില: ${record.paymentStatus || 'Paid'}`;
        });
        entityReport += appendMatches('വരവുകൾ', matchedIncome, (record) => {
          const receipt = record.manualReceiptNo || record.digitalReceiptNo || '-';
          return `തീയതി: ${record.date || '-'} | രസീത് #${receipt} | പേര്: ${record.payerName || '-'} | വിഭാഗം: ${record.category || '-'} | തുക: ₹${(Number(record.amount) || 0).toLocaleString('en-IN')}`;
        });
        entityReport += appendMatches('റിഫ്രഷ്മെന്റുകൾ', matchedRefreshments, (record) =>
          `തീയതി: ${record.date || '-'} | വിവരണം: ${record.being || record.description || '-'} | വിഭാഗം: ${record.category || '-'} | തുക: ₹${(Number(record.amount) || 0).toLocaleString('en-IN')}`
        );
        algorithmicSections.push(entityReport.trim());
      } else {
        algorithmicSections.push(`[LOCAL SEARCH RESULT]: തിരഞ്ഞ പദങ്ങൾ (${keywords.join(', ')}) ഉപയോഗിച്ച് local income, expense, refreshments രേഖകളിൽ പൊരുത്തമുള്ള എൻട്രികൾ ഒന്നും കണ്ടെത്തിയില്ല. ഈ തിരച്ചിലിൽ കിട്ടാത്ത രേഖകളെക്കുറിച്ച് കണക്കുകൾ ഊഹിക്കരുത്.`);
      }
    }

    // --- TOOL 3: SPECIAL EVENTS TOOL ---
    const qLower = userQuestion.toLowerCase();
    const isEventQuery = qLower.includes('ഇവന്റ്') || qLower.includes('പരിപാടി') || qLower.includes('പ്രോഗ്രാം') || qLower.includes('event');
    if (isEventQuery || allEvents.some(ev => qLower.includes((ev.name || '').toLowerCase()))) {
      if (allEvents.length > 0) {
        let eventReport = `\n[സ്പെഷ്യൽ ഇവന്റുകൾ (SPECIAL EVENTS)]:\n`;
        allEvents.forEach((ev, idx) => {
          const txs = allEventTxs.filter(t => t.event_id === ev.id);
          const evIncome = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
          const evExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
          const evNet = evIncome - evExpense;
          eventReport += `${idx + 1}. ഇവന്റ്: "${ev.name}" (Status: ${ev.status || 'active'})\n   - ആകെ വരവ്: ₹${evIncome.toLocaleString('en-IN')}\n   - ആകെ ചിലവ്: ₹${evExpense.toLocaleString('en-IN')}\n   - നെറ്റ് ബാലൻസ്: ₹${evNet.toLocaleString('en-IN')}\n`;
        });
        algorithmicSections.push(eventReport.trim());
      } else {
        algorithmicSections.push(`[സ്പെഷ്യൽ ഇവന്റുകൾ]: നിലവിൽ പ്രത്യേക ഇവന്റുകൾ ഒന്നും സിസ്റ്റത്തിൽ രജിസ്റ്റർ ചെയ്തിട്ടില്ല.`);
      }
    }

    // --- TOOL 4: MACRO MULTI-MONTH MASTER DATABASE SUMMARY ---
    const monthMap = {};
    let totalIncomeAll = 0;
    let totalExpenseAll = 0;
    let totalRefAll = 0;
    const globalCategoryTotals = {};
    const globalPendingList = [];

    const getMonthObj = (m) => {
      if (!monthMap[m]) {
        monthMap[m] = {
          month: m,
          income: 0,
          incomeCount: 0,
          expense: 0,
          expenseCount: 0,
          ref: 0,
          refCount: 0,
          categories: {},
          pending: []
        };
      }
      return monthMap[m];
    };

    allIncome.forEach(r => {
      const m = (r.date || '').slice(0, 7) || 'UNKNOWN';
      const amt = Number(r.amount) || 0;
      totalIncomeAll += amt;
      const mo = getMonthObj(m);
      mo.income += amt;
      mo.incomeCount++;
    });

    allExpenses.forEach(r => {
      const m = (r.date || '').slice(0, 7) || 'UNKNOWN';
      const amt = Number(r.amount) || 0;
      totalExpenseAll += amt;
      const mo = getMonthObj(m);
      mo.expense += amt;
      mo.expenseCount++;

      const cat = (r.category || 'OTHER').toUpperCase().trim();
      mo.categories[cat] = (mo.categories[cat] || 0) + amt;
      globalCategoryTotals[cat] = (globalCategoryTotals[cat] || 0) + amt;

      if ((r.paymentStatus || '').toLowerCase() === 'pending') {
        const pItem = {
          date: r.date,
          month: m,
          voucher: r.manualVoucherNo || r.voucherNo || '-',
          paidTo: r.paidTo || r.being || 'Unknown',
          being: r.being || '',
          amount: amt
        };
        mo.pending.push(pItem);
        globalPendingList.push(pItem);
      }
    });

    allRefreshments.forEach(r => {
      const m = (r.date || '').slice(0, 7) || 'UNKNOWN';
      const amt = Number(r.amount) || 0;
      totalRefAll += amt;
      const mo = getMonthObj(m);
      mo.ref += amt;
      mo.refCount++;
    });

    const netAll = totalIncomeAll - totalExpenseAll - totalRefAll;
    const sortedMonths = Object.keys(monthMap).filter(m => m !== 'UNKNOWN').sort().reverse();

    let text = `
=== മഖ്ദൂമിയ്യ അക്കാദമി അക്കൗണ്ട്സ് മാസ്റ്റർ ഡാറ്റാബേസ് (MASTER DATABASE) ===
ലഭ്യമായ മാസങ്ങൾ: ${sortedMonths.join(', ')}

[മൊത്തം കണക്കുകൾ (ALL-TIME SUMMARY)]:
- ആകെ വരവ്: ₹${totalIncomeAll.toLocaleString('en-IN')} (${allIncome.length} എൻട്രികൾ)
- ആകെ ചിലവ്: ₹${totalExpenseAll.toLocaleString('en-IN')} (${allExpenses.length} എൻട്രികൾ)
- മൊത്തം നെറ്റ് ബാലൻസ്: ₹${netAll.toLocaleString('en-IN')} (${netAll >= 0 ? 'നീക്കിയിരിപ്പ്' : 'കമ്മി'})
`;

    // Add Algorithmic query search results directly at the top
    if (algorithmicSections.length > 0) {
      text = `
=== [അൽഗോരിതം പരിശോധിച്ചു കണ്ടെത്തിയ കൃത്യമായ കണക്കുകൾ (ALGORITHMIC SEARCH RESULTS)] ===
${algorithmicSections.join('\n\n')}

` + text;
    }

    const questionLower = userQuestion.toLowerCase();
    const asksMonthBreakdown = /month[- ]?(?:wise|by|to month)|monthly comparison|compare months|which month|highest.*expense|lowest.*expense|ഏത് മാസ|മാസംതോറും|മാസങ്ങളിലെ താരതമ|മാസം തിരിച്ച|മാസംതിരിച്ച|ഏറ്റവും.*ചിലവ്/.test(questionLower);
    if (asksMonthBreakdown) {
      text += `\n[ഓരോ മാസത്തെയും വേർതിരിച്ചുള്ള സംഗ്രഹം]:\n`;
      sortedMonths.forEach(m => {
        const mo = monthMap[m];
        const net = mo.income - mo.expense - mo.ref;
        const topCats = Object.entries(mo.categories)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([c, a]) => `${c}: ₹${a.toLocaleString('en-IN')}`)
          .join(', ');

        text += `• മാസം ${m}: വരവ് ₹${mo.income.toLocaleString('en-IN')} | ചിലവ് ₹${mo.expense.toLocaleString('en-IN')} | റിഫ്രഷ്മെന്റ് ₹${mo.ref.toLocaleString('en-IN')} | നെറ്റ്: ₹${net.toLocaleString('en-IN')} | പ്രധാന ചിലവുകൾ: ${topCats || 'ഡാറ്റയില്ല'}\n`;
      });
    }

    const asksAllCategories = /all categories|every categor|എല്ലാ.*വിഭാഗ|എല്ലാ.*കാറ്റഗറി/.test(questionLower);
    const allSortedGlobalCats = Object.entries(globalCategoryTotals)
      .sort((a, b) => b[1] - a[1]);
    const sortedGlobalCats = (asksAllCategories ? allSortedGlobalCats : allSortedGlobalCats.slice(0, 8))
      .map(([c, a]) => `- ${c}: ₹${a.toLocaleString('en-IN')}`)
      .join('\n');

    text += `\n[മൊത്തത്തിൽ ഏറ്റവും കൂടുതൽ പണം ചിലവായ പ്രധാന കാറ്റഗറികൾ]:\n${sortedGlobalCats}\n`;

    const asksPendingDetails = /pending|unpaid|ബാക്കി|പെൻഡിങ്|പെന്‍ഡിങ്|നൽകാൻ/.test(questionLower);
    if (asksPendingDetails && globalPendingList.length > 0) {
      text += `\n[എല്ലാ പെൻഡിങ് വൗച്ചറുകളും (${globalPendingList.length})]:\n` + globalPendingList.map(p => `- [${p.month}] വൗച്ചർ #${p.voucher} (${p.paidTo}): ₹${p.amount.toLocaleString('en-IN')} - ${p.being}`).join('\n') + '\n';
    }

    return text.trim();
  } catch (err) {
    console.warn('[AnalyticsEngine] getFullMasterContext error:', err);
    return '[LOCAL_DB_READ_ERROR] ഡാറ്റാബേസ് റീഡ് ചെയ്യുന്നതിൽ തടസ്സം നേരിട്ടു.';
  }
}
