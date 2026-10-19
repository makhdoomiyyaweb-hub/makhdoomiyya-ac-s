# React + Vite

## Transaction filters and editing

Income, Expense, Refreshment and per-event transaction lists support local date
filtering and partial search across record details. Filters affect displayed rows;
existing overall totals and print/export scope are preserved. Events can also be
searched by name/description. The calendar supports a specific day, month presets
and changing the year; Clear restores all dates.

Edit opens a prefilled form and updates the existing Dexie record in a transaction.
IDs, generated receipt/voucher numbers, event ownership and creation timestamps
are preserved. Stale/deleted local records reject a save. The queue retains edits
offline and retries using an UPDATE by ID, not an insert/upsert. A still-unsynced
new entry retains its original create operation and ID until first upload.

When a server `updated_at` is available, edits compare it on update to avoid
overwriting a newer remote version. Failed or conflicting cloud updates retain
the local edit for review/retry; they do not recreate a missing/deleted cloud row.
Automatic conflict resolution is not implemented. Local sync metadata is excluded
from cloud payloads. Cloud responses cannot mark a newer local edit as synced.

`supabase/migrations/20261019061851_transaction_edit_updated_at.sql` supplies
update timestamps for the four transaction tables, including event transactions.
It changes no row IDs, numbering, RLS policies or grants. This migration has NOT
been applied or runtime-tested against production. Verify the target schema,
existing triggers, permissions and migration history before applying it.

Focused verification (the browser test intercepts all external calls and uses
an isolated Chromium profile, never the user's database):

```sh
node --test tests/record-filters.test.mjs
npm run dev -- --host 127.0.0.1 --port 5186 --strictPort
# In another terminal:
node tests/transaction-edit.browser.cjs
npm run build
```

The browser suite checks same-ID edits, offline saves/retries, backend row counts,
missing rows, stale local/remote versions and phone-to-desktop dialog layouts.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
