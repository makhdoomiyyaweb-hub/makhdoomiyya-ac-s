// Isolated temporary Chromium profile; every external request is intercepted.
// No production DB, user browser storage, or real Supabase API is used.
const puppeteer = require('puppeteer');
const assert = require('node:assert/strict');
require('node:fs').mkdirSync('output/transaction-edit-qa', { recursive: true });
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5186';
const remote = new Map();
const requests = [];
const fixtures = [
  ['income', { id: 'qa-income', type: 'income', date: '2026-06-15', category: 'DONATION', payerName: 'QA Donor', amount: 100, digitalReceiptNo: 'QA-001', seqNo: 1, paymentStatus: 'Received' }],
  ['expenses', { id: 'qa-expense', type: 'expense', date: '2026-06-15', category: 'FOOD', paidTo: 'QA Shop', being: 'Meals', amount: 100, voucherNo: 'QA-V001', paymentStatus: 'Paid' }],
  ['refreshments', { id: 'qa-refreshment', type: 'refreshment', date: '2026-06-15', item: 'Tea', quantity: 1, amount: 100, notes: 'QA Tea', paymentStatus: 'Paid' }],
  ['event_transactions', { id: 'qa-event-tx', event_id: 'qa-event', type: 'income', date: '2026-06-15', category: 'DONATION', payerName: 'QA Event Donor', amount: 100, paymentStatus: 'Received' }],
];
const initialVersion = '2026-06-15T12:00:00.000Z';
for (const [table, row] of fixtures) remote.set(`${table}:${row.id}`, { ...row, updated_at: initialVersion });

async function run() {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1366, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (url.origin === base) return request.continue();
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').pop();
        const method = request.method();
        if (method === 'OPTIONS') return request.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': '*' } });
        const body = request.postData() ? JSON.parse(request.postData()) : null;
        requests.push({ method, table, body });
        let data = [];
        if (method === 'PATCH') {
          const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
          const key = `${table}:${id}`;
          const version = (url.searchParams.get('updated_at') || '').replace(/^eq\./, '');
          const eventId = (url.searchParams.get('event_id') || '').replace(/^eq\./, '');
          if (remote.has(key) && !remote.get(key).is_deleted && (!version || remote.get(key).updated_at === version) && (!eventId || remote.get(key).event_id === eventId)) {
            const updated_at = new Date(Date.parse(remote.get(key).updated_at || initialVersion) + 1000).toISOString();
            remote.set(key, { ...remote.get(key), ...body, updated_at });
            data = [{ id, updated_at }];
          }
        } else if (method === 'POST') {
          for (const row of (Array.isArray(body) ? body : [body])) remote.set(`${table}:${row.id}`, row);
          data = body;
        }
        return request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' }, body: JSON.stringify(data) });
      }
      return request.abort();
    });
    await page.evaluateOnNewDocument(() => {
      window.qaOnline = false;
      Object.defineProperty(navigator, 'onLine', { get: () => window.qaOnline, configurable: true });
      localStorage.setItem('dawa_hydration_state', 'complete');
    });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.evaluate(async rows => {
      window.qaDb = (await import('/src/utils/db.js')).default;
      window.qaEdit = await import('/src/utils/editTransaction.js');
      window.qaEngine = await import('/src/sync/engine.js');
      for (const [table, row] of rows) await window.qaDb[table].put({ ...row, created_at: '2026-06-15T12:00:00Z', updated_at: '2026-06-15T12:00:00.000Z', synced: true, sync_status: 'synced' });
      await window.qaDb.events.put({ id: 'qa-event', name: 'QA Event', status: 'active', created_at: '2026-06-15', synced: true, sync_status: 'synced' });
    }, fixtures);

    const routeByTable = { income: 'income', expenses: 'expense', refreshments: 'refreshment', event_transactions: 'events/qa-event' };
    async function openEdit() {
      await page.waitForSelector('[data-record-id] [aria-label="Record actions"]');
      const buttons = await page.$$('[data-record-id] [aria-label="Record actions"]');
      for (const button of buttons) if (await button.boundingBox()) { await button.click(); break; }
      await page.waitForSelector('[aria-label="Record actions menu"]');
      await page.evaluate(() => [...document.querySelectorAll('[aria-label="Record actions menu"] button')].find(button => button.textContent.trim() === 'Edit').click());
      await page.waitForSelector('[role="dialog"]');
    }
    for (const [table, fixture] of fixtures) {
      console.log('Checking edit UI:', table);
      await page.evaluate(route => { location.hash = '#/' + route; }, routeByTable[table]);
      await page.waitForSelector('input[aria-label="Search records"]');
      await page.locator('input[aria-label="Search records"]').fill('QA');
      try { await openEdit(); } catch (error) {
        console.log(await page.evaluate(() => ({ hash: location.hash, actions: [...document.querySelectorAll('[aria-label="Record actions"]')].map(e => ({ expanded: e.getAttribute('aria-expanded'), rect: JSON.stringify(e.getBoundingClientRect()) })), body: document.body.innerText.slice(-1800) })));
        await page.screenshot({ path: 'output/transaction-edit-qa/edit-failure.png', fullPage: true });
        throw error;
      }
      await page.locator('[role="dialog"] input[name="amount"]').fill('175.25');
      await page.evaluate(() => { const save = document.querySelector('[role="dialog"] button[type="submit"]'); save.click(); save.click(); });
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      const result = await page.evaluate(async ({ table, id }) => ({ count: await window.qaDb[table].count(), row: await window.qaDb[table].get(id) }), { table, id: fixture.id });
      assert.equal(result.count, 1, `${table}: no duplicate local row`);
      assert.equal(result.row.amount, 175.25);
      assert.equal(result.row.id, fixture.id);
      assert.equal(result.row.sync_operation, 'update');
      assert.equal(result.row.synced, false);
      if (fixture.event_id) assert.equal(result.row.event_id, fixture.event_id);
      if (fixture.digitalReceiptNo) assert.equal(result.row.digitalReceiptNo, fixture.digitalReceiptNo);
      if (fixture.voucherNo) assert.equal(result.row.voucherNo, fixture.voucherNo);
    }
    const remoteCount = remote.size;
    await page.evaluate(async () => { window.qaOnline = true; await window.qaEngine.syncPendingRecords(); await window.qaEngine.syncPendingRecords(); });
    assert.equal(remote.size, remoteCount, 'retry must not add backend rows');
    assert.equal(requests.filter(r => r.method === 'POST').length, 0, 'editing existing rows must not INSERT/UPSERT');
    for (const [table, row] of fixtures) assert.equal(remote.get(`${table}:${row.id}`).amount, 175.25);

    // A second edit uses the timestamp returned by the first save.
    await page.evaluate(async () => {
      const row = await window.qaDb.refreshments.get('qa-refreshment');
      await window.qaEdit.saveTransactionEdit('refreshments', row, { ...row, notes: 'Second edit' });
    });
    assert.equal(remote.get('refreshments:qa-refreshment').notes, 'Second edit');

    // A newer change on another device must not be silently overwritten.
    remote.set('expenses:qa-expense', { ...remote.get('expenses:qa-expense'), amount: 999, updated_at: '2026-07-01T00:00:00.000Z' });
    await page.evaluate(async () => {
      const row = await window.qaDb.expenses.get('qa-expense');
      await window.qaEdit.saveTransactionEdit('expenses', row, { ...row, amount: 300 });
    });
    assert.equal(remote.get('expenses:qa-expense').amount, 999);
    assert.equal(await page.evaluate(async () => (await window.qaDb.expenses.get('qa-expense')).synced), false);

    // Missing backend rows are not recreated, even after retry.
    remote.delete('income:qa-income');
    await page.evaluate(async () => {
      const original = await window.qaDb.income.get('qa-income');
      await window.qaEdit.saveTransactionEdit('income', original, { ...original, amount: 190 });
      await window.qaEngine.retryFailedRecords().catch(() => {});
    });
    assert.equal(remote.has('income:qa-income'), false);
    assert.equal(await page.evaluate(async () => (await window.qaDb.income.get('qa-income')).sync_status), 'failed');

    // Reject stale form data and attempts to change immutable fields.
    await page.evaluate(async () => {
      window.qaOnline = false;
      const original = await window.qaDb.expenses.get('qa-expense');
      await window.qaDb.expenses.update(original.id, { amount: 200 });
      let rejected = false;
      try { await window.qaEdit.saveTransactionEdit('expenses', original, { ...original, amount: 300 }); } catch { rejected = true; }
      if (!rejected || (await window.qaDb.expenses.get(original.id)).amount !== 200) throw new Error('Stale edit was not rejected');
      const current = await window.qaDb.event_transactions.get('qa-event-tx');
      await window.qaEdit.saveTransactionEdit('event_transactions', current, { ...current, amount: 180, id: 'duplicate', event_id: 'another-event' });
      const saved = await window.qaDb.event_transactions.get(current.id);
      if (saved.event_id !== 'qa-event' || await window.qaDb.event_transactions.count() !== 1) throw new Error('Identity changed');
      const inFlight = await window.qaDb.event_transactions.get(current.id);
      await window.qaDb.event_transactions.update(current.id, { notes: 'Newer queued edit' });
      await window.qaEngine.settleSyncedRecord('event_transactions', inFlight, { updated_at: '2026-06-16T00:00:00.000Z' });
      const pending = await window.qaDb.event_transactions.get(current.id);
      if (pending.synced || pending.notes !== 'Newer queued edit') throw new Error('Older response acknowledged a newer edit');
    });

    // A new entry created offline retains its original ID when edited before upload.
    await page.evaluate(async () => {
      const row = { id: 'qa-offline-new', type: 'expense', date: '2026-06-15', category: 'FOOD', being: 'New offline entry', amount: 25, paymentStatus: 'Paid', synced: false, sync_status: 'pending', sync_operation: 'create' };
      await window.qaDb.expenses.put(row);
      await window.qaEdit.saveTransactionEdit('expenses', row, { ...row, amount: 50 });
      window.qaOnline = true;
      await window.qaEngine.retryFailedRecords().catch(() => {});
      await window.qaEngine.retryFailedRecords().catch(() => {});
      window.qaOnline = false;
    });
    assert.equal(remote.get('expenses:qa-offline-new').amount, 50);
    assert.equal(requests.filter(r => r.method === 'POST').length, 1, 'one initial upload, never another insertion from edit/retry');

    // Narrow phones through desktop: toolbar, calendar and edit dialog fit viewport.
    await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some(el => el.textContent.includes('Changes saved')));
    for (const width of [320, 375, 768, 1024, 1440]) {
      console.log('Checking responsive UI:', width);
      await page.setViewport({ width, height: 900 });
      await page.evaluate(() => { location.hash = '#/refreshment'; });
      await page.waitForSelector('input[aria-label="Search records"]');
      try { await openEdit(); } catch (error) {
        await page.screenshot({ path: 'output/transaction-edit-qa/edit-responsive-failure.png', fullPage: true });
        console.log(await page.evaluate(() => ({ hash: location.hash, width: innerWidth, body: document.body.innerText.slice(-1300) })));
        throw error;
      }
      assert.equal(await page.evaluate(() => { const r = document.querySelector('[role="dialog"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), true, `edit bounds at ${width}`);
      await page.screenshot({ path: `output/transaction-edit-qa/edit-${width}.png` });
      await page.click('[aria-label="Close edit"]');
      await page.waitForFunction(() => !document.querySelector('[aria-labelledby="edit-transaction-title"]'));
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'All dates').click());
      await page.waitForSelector('input[aria-label="Calendar year"]');
      await page.locator('input[aria-label="Calendar year"]').fill('2026');
      await page.screenshot({ path: `output/transaction-edit-qa/calendar-${width}.png` });
      assert.equal(await page.evaluate(() => { const r = document.querySelector('[role="dialog"][aria-label="Select Date"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), true);
      await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Select Date"] button')].find(button => button.textContent.trim() === 'Cancel').click());
      await page.waitForFunction(() => !document.querySelector('input[aria-label="Calendar year"]'));
    }
    // Exercise the calendar's day selection and clearing against actual displayed rows.
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'All dates').click());
    await page.waitForSelector('[aria-label="Calendar year"]');
    await page.evaluate(() => [...document.querySelectorAll('[aria-label="Select Date"] button')].find(button => button.textContent.trim() === '16').click());
    await page.waitForFunction(() => document.body.innerText.includes('No matching records'));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Clear' && button.closest('.space-y-2')).click());
    await page.waitForSelector('[data-record-id="qa-refreshment"]');
    assert.deepEqual(errors, [], 'no page runtime errors');
    console.log(JSON.stringify({ passed: true, editedTables: fixtures.map(([table]) => table), backendEditRequests: requests.filter(r => r.method === 'PATCH').length, existingRowEditInserts: 0, offlineNewEntryInitialUploads: requests.filter(r => r.method === 'POST').length, widths: [320, 375, 768, 1024, 1440], checks: ['offline edits', 'double save', 'same ID/numbering/ownership', 'retry without duplication', 'missing backend row not recreated', 'stale local and remote save rejected', 'in-flight edit retained', 'offline new entry edited before upload', 'responsive dialogs', 'calendar selection and clear'] }));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
