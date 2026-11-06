// Isolated profile with every external request intercepted; never uses production data.
const puppeteer = require('puppeteer');
const assert = require('node:assert/strict');
require('node:fs').mkdirSync('output/entry-forms-qa', { recursive: true });
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5190';

async function run() {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [], payloads = [];
    const remote = new Map();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === base) return request.continue();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-expose-headers': '*' };
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').pop();
        const body = request.postData() ? JSON.parse(request.postData()) : null;
        let data = [];
        if (request.method() === 'POST') {
          for (const record of (Array.isArray(body) ? body : [body])) {
            remote.set(`${table}:${record.id}`, { ...record, updated_at: '2026-11-05T00:00:00.000Z' });
            data.push({ id: record.id, updated_at: '2026-11-05T00:00:00.000Z' });
          }
          payloads.push({ table, body });
        } else if (request.method() === 'PATCH') {
          const id = url.searchParams.get('id')?.replace(/^eq\./, '');
          if (remote.has(`${table}:${id}`)) {
            remote.set(`${table}:${id}`, { ...remote.get(`${table}:${id}`), ...body });
            data = [{ id, updated_at: '2026-11-05T00:00:00.000Z' }];
          }
          payloads.push({ table, body });
        }
        return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) });
      }
      return request.abort();
    });
    await page.evaluateOnNewDocument(() => {
      window.qaOnline = false;
      Object.defineProperty(navigator, 'onLine', { get: () => window.qaOnline });
      localStorage.setItem('dawa_hydration_state', 'complete');
    });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => {
      window.qaDb = (await import('/src/utils/db.js')).default;
      window.qaEngine = await import('/src/sync/engine.js');
      for (const id of ['qa-a', 'qa-b']) await window.qaDb.events.put({ id, name: id, status: 'active', synced: true, sync_status: 'synced', created_at: '2026-06-01' });
      for (const [key, date] of [['income', '2026-06-01'], ['expense', '2026-06-02'], ['refreshment', '2026-06-03'], ['event:qa-a:income', '2026-06-04'], ['event:qa-a:expense', '2026-06-05']]) sessionStorage.setItem(`dawa:entry-date:${key}`, date);
    });
    async function route(value) {
      await page.evaluate(value => { location.hash = '#/' + value; }, value);
      if (['income', 'expense', 'refreshment'].includes(value)) {
        await page.waitForSelector('form input[name="amount"]');
      } else {
        await page.waitForFunction(value => [...document.querySelectorAll('h1')].some(el => el.textContent === (value === 'events' ? 'Events' : value.split('/')[1])), {}, value);
      }
    }
    const visibleForm = 'form';
    async function restoreModules() {
      await page.evaluate(async () => {
        window.qaDb = (await import('/src/utils/db.js')).default;
        window.qaEngine = await import('/src/sync/engine.js');
      });
    }
    async function dateValue(name = 'date') { return page.$eval(`input[name="${name}"]`, el => el.value); }
    async function fill(name, value) { await page.locator(`form input[name="${name}"]`).fill(value); }
    async function closePreview() {
      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')];
        const close = buttons.find(b => b.title === 'Close' || b.getAttribute('aria-label') === 'Close');
        if (close) close.click();
      });
      // Income/expense previews have a top-right X button without a label.
      await page.evaluate(() => {
        for (const overlay of document.querySelectorAll('.fixed.inset-0')) {
          const button = overlay.querySelector('button');
          if (button && overlay.textContent.includes('Preview')) button.click();
        }
      });
    }
    const specs = [
      { route: 'income', table: 'income', date: '2026-06-01', order: ['date', 'amount', 'category', 'remarks'], category: 'DONATION' },
      { route: 'expense', table: 'expenses', date: '2026-06-02', order: ['date', 'amount', 'category', 'being', 'paymentStatus', 'remarks'], category: 'FOOD' },
      { route: 'refreshment', table: 'refreshments', date: '2026-06-03', order: ['amount', 'date', 'item', 'quantity', 'paymentStatus', 'remarks'] },
    ];
    for (const spec of specs) {
      console.log('Checking entry form:', spec.table);
      await route(spec.route);
      await page.waitForSelector('form input[name="amount"]');
      const order = await page.$eval(visibleForm, form => [...form.querySelectorAll('input[name],select[name]')].map(el => el.name));
      assert.deepEqual(order.slice(0, spec.order.length), spec.order);
      if (spec.route !== 'refreshment') {
        assert.equal(await page.$eval('form button[aria-controls]', button => button.getAttribute('aria-expanded')), 'false', 'optional fields start collapsed');
        const optionalName = spec.route === 'income' ? 'manualReceiptNo' : 'manualVoucherNo';
        assert.equal(await page.$eval(`form input[name="${optionalName}"]`, input => input.closest('[id$="optional-fields"]').hidden), true, 'optional inputs start hidden');
        assert.equal(await page.$eval(`form input[name="${optionalName}"]`, input => input.getBoundingClientRect().height), 0, 'optional inputs are visually hidden initially');
        assert.equal(await page.$$eval('form input[name="remarks"]', inputs => inputs.length), 1, 'remarks appears once');
        const actionOrder = await page.$eval('form', form => {
          const submit = form.querySelector('button[type="submit"]');
          const firstField = form.querySelector('input[name="date"]').parentElement.parentElement;
          return submit.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING;
        });
        assert.ok(actionOrder, 'save actions precede form fields');
        await page.click('form button[aria-controls]');
        assert.equal(await page.$eval('form button[aria-controls]', button => button.getAttribute('aria-expanded')), 'true');
        assert.equal(await page.$eval(`form input[name="${optionalName}"]`, input => input.closest('[id$="optional-fields"]').hidden), false, 'optional inputs appear after expanding');
        assert.ok(await page.$eval(`form input[name="${optionalName}"]`, input => input.getBoundingClientRect().height > 0), 'optional inputs become visible after expanding');
        await fill(optionalName, 'Optional value retained');
        await page.click('form button[aria-controls]');
        await page.click('form button[aria-controls]');
        assert.equal(await page.$eval(`form input[name="${optionalName}"]`, input => input.value), 'Optional value retained', 'collapsing and reopening retains optional values');
        await page.click('form button[aria-controls]');
      }
      assert.equal(await dateValue(), spec.date);
      await fill('amount', '125');
      if (spec.category) await fill('category', spec.category);
      if (spec.route === 'expense') await fill('being', 'Required purpose');
      if (spec.route === 'refreshment') { await page.select('form select[name="item"]', 'Tea'); await page.select('form select[name="paymentStatus"]', 'Paid'); }
      await page.click('form button[type="submit"]');
      await page.waitForFunction(async table => (await window.qaDb[table].count()) === 1, {}, spec.table);
      assert.equal(await dateValue(), spec.date, 'save keeps selected date');
      const first = await page.evaluate(async table => (await window.qaDb[table].toArray())[0], spec.table);
      assert.equal(first.remarks, '', 'remarks optional');
      if (spec.category) assert.ok(first.amountInWords, 'amount-to-words remains active');
      await closePreview();
      // Navigation also dismisses previews; state restores from session storage.
      await route('refreshment');
      await route(spec.route);
      await fill('amount', '250');
      if (spec.category) await fill('category', spec.category);
      if (spec.route === 'expense') await fill('being', 'Second purpose');
      if (spec.route === 'refreshment') { await page.select('form select[name="item"]', 'Tea'); await page.select('form select[name="paymentStatus"]', 'Paid'); }
      await fill('remarks', `QA remarks ${spec.table}`);
      if (spec.route === 'refreshment') await fill('notes', 'Separate refreshment notes');
      await page.click('form button[type="submit"]');
      await page.waitForFunction(async table => (await window.qaDb[table].count()) === 2, {}, spec.table);
      await route('events');
      await route(spec.route);
      await page.evaluate(() => [...document.querySelectorAll('form button')].find(b => b.textContent.trim() === 'Clear').click());
      assert.equal(await dateValue(), spec.date, 'clear keeps selected date');
      await page.reload({ waitUntil: 'networkidle0' });
      await restoreModules();
      assert.equal(await dateValue(), spec.date, 'reload keeps selected date');
      assert.equal(await page.evaluate(async table => (await window.qaDb[table].toArray()).some(row => row.remarks === `QA remarks ${table}`), spec.table), true);
      if (spec.route === 'refreshment') assert.equal(await page.evaluate(async () => (await window.qaDb.refreshments.toArray()).find(row => row.remarks === 'QA remarks refreshments').notes), 'Separate refreshment notes');
    }

    // Exercise the actual custom calendar and its event-object callback.
    await page.$eval('form input[name="date"]', el => el.parentElement.querySelector('button').click());
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '8').click());
    assert.equal(await dateValue(), '2026-06-08');
    await page.evaluate(() => [...document.querySelectorAll('form button')].find(b => b.textContent.trim() === 'Clear').click());
    assert.equal(await dateValue(), '2026-06-08');

    async function openEvent(type) {
      await page.evaluate(type => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === (type === 'income' ? '+ Add Income' : '- Add Expense')).click(), type);
      await page.waitForSelector('input[name="event-amount"]');
    }
    for (const type of ['income', 'expense']) {
      await route('events/qa-a');
      await openEvent(type);
      assert.equal(await dateValue('event-date'), type === 'income' ? '2026-06-04' : '2026-06-05');
      assert.deepEqual(await page.$eval('form', form => [...form.querySelectorAll('input[name],select[name]')].map(el => el.name).slice(0, 5)), ['event-amount', 'event-date', 'event-category', 'event-status', 'event-remarks']);
      await page.$eval('input[name="event-date"]', el => el.parentElement.querySelector('button').click());
      await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '9').click());
      await fill('event-amount', '300');
      await fill('event-remarks', `QA event ${type}`);
      await fill('event-notes', 'Separate event notes');
      await page.click('form button[type="submit"]');
      await page.waitForFunction(() => !document.querySelector('input[name="event-amount"]'));
      await openEvent(type);
      assert.equal(await dateValue('event-date'), '2026-06-09');
      await fill('event-amount', '400');
      await page.click('form button[type="submit"]');
      await page.waitForFunction(() => !document.querySelector('input[name="event-amount"]'));
      await page.reload({ waitUntil: 'networkidle0' });
      await restoreModules();
      await openEvent(type);
      assert.equal(await dateValue('event-date'), '2026-06-09');
      await page.evaluate(() => [...document.querySelectorAll('form button')].find(b => b.textContent.trim() === 'Cancel').click());
    }
    await route('events/qa-b');
    await openEvent('income');
    const today = await page.evaluate(async () => (await import('/src/utils/entryDate.js')).localToday());
    assert.equal(await dateValue('event-date'), today, 'another event starts today');
    await page.evaluate(() => [...document.querySelectorAll('form button')].find(b => b.textContent.trim() === 'Cancel').click());

    // All queued remarks travel through the real sync engine with mocked REST.
    await page.evaluate(async () => { window.qaOnline = true; await window.qaEngine.retryFailedRecords(); });
    for (const table of ['income', 'expenses', 'refreshments', 'event_transactions']) {
      assert.ok(payloads.some(p => p.table === table && JSON.stringify(p.body).includes('QA')), `${table} sends remarks`);
    }
    await page.evaluate(async () => {
      window.qaOnline = false;
      const edit = await import('/src/utils/editTransaction.js');
      for (const table of ['income', 'expenses', 'refreshments', 'event_transactions']) {
        const original = (await window.qaDb[table].toArray())[0];
        const count = await window.qaDb[table].count();
        await edit.saveTransactionEdit(table, original, { ...original, remarks: 'Edited remark', paymentStatus: original.paymentStatus || (original.type === 'income' ? 'Received' : 'Paid') });
        if ((await window.qaDb[table].get(original.id)).remarks !== 'Edited remark' || (await window.qaDb[table].count()) !== count) throw Error('Edit remarks failed');
      }
      window.qaOnline = true;
      await window.qaEngine.syncPendingRecords();
    });
    for (const table of ['income', 'expenses', 'refreshments', 'event_transactions']) assert.ok([...remote.entries()].some(([key, row]) => key.startsWith(table + ':') && row.remarks === 'Edited remark'));

    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewport({ width, height: 1000 });
      for (const spec of specs) {
        await route(spec.route);
        const info = await page.$eval('form input[name="amount"]', el => {
          const rect = el.getBoundingClientRect();
          const first = el.form.querySelector('input[name="date"]');
          const formRect = el.form.getBoundingClientRect();
          return { first: first.name, fits: rect.left >= 0 && rect.right <= innerWidth, formFits: el.form.scrollWidth <= el.form.clientWidth, toolbarFits: [...el.form.querySelectorAll('button')].filter(button => ['Save Income', 'Save Expense', 'Clear', 'More fields'].includes(button.textContent.trim())).every(button => { const r = button.getBoundingClientRect(); return r.left >= formRect.left && r.right <= formRect.right; }) };
        });
        assert.equal(info.first, 'date');
        assert.equal(info.fits, true, `${spec.route} fits ${width}`);
        if (spec.route !== 'refreshment') {
          assert.equal(info.formFits, true, `${spec.route} form has no horizontal overflow at ${width}`);
          assert.equal(info.toolbarFits, true, `${spec.route} action toolbar fits at ${width}`);
        }
        if (width === 375 || width === 1440) await page.screenshot({ path: `output/entry-forms-qa/${spec.route}-${width}.png` });
      }
      for (const type of ['income', 'expense']) {
        await route('events/qa-a'); await openEvent(type);
        assert.equal(await page.$eval('form input:not([type="hidden"])', el => el.name), 'event-amount');
        if (width === 375 || width === 1440) await page.screenshot({ path: `output/entry-forms-qa/event-${type}-${width}.png` });
        await page.evaluate(() => [...document.querySelectorAll('form button')].find(b => b.textContent.trim() === 'Cancel').click());
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, forms: 5, widths: [320, 375, 768, 1024, 1440], checks: ['date-first Income/Expense order', 'collapsed optional fields', 'top save/clear actions', 'responsive form and toolbar fit', 'required-only save', 'optional remarks', 'save/clear/reload date retention', 'event/type date isolation', 'calendar day selection', 'remarks cloud payload', 'same-ID remarks edit'] }));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
// All external requests are intercepted by the test's isolated local fixture.
