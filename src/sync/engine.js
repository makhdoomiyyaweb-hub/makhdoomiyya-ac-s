/**
 * engine.js — Centralized Local-First Sync Engine
 *
 * Provides three core functions used by both useSync.js and the interval timer:
 *   • syncPendingRecords()  — push all sync_status='pending' records to cloud
 *   • retryFailedRecords()  — reset sync_status='failed' → 'pending' and re-sync
 *   • logSync()             — write a sync attempt to the local sync_log table
 *
 * Design notes:
 *   - Full Soft Delete architecture: records with is_deleted=true are upserted
 *     to Supabase (tombstone), never physically deleted from cloud.
 *   - Other devices detect the tombstone on next pull and remove locally.
 *   - New rows use upsert(onConflict:'id'); edited rows use UPDATE by existing ID.
 */

import db from '../utils/db';
import { supabase } from '../utils/supabase';
import { sameRecord } from '../utils/recordFilters';

const TABLES = ['income', 'expenses', 'refreshments', 'app_config', 'events', 'event_transactions'];
const stripFields = (record, fields) => Object.fromEntries(Object.entries(record).filter(([key]) => !fields.includes(key)));

export async function settleSyncedRecord(tableName, snapshot, serverRecord) {
  await db.transaction('rw', db[tableName], async () => {
    const current = await db[tableName].get(snapshot.id);
    if (sameRecord(snapshot, current)) {
      await db[tableName].update(snapshot.id, { synced: true, sync_status: 'synced', sync_operation: undefined,
        ...(serverRecord?.updated_at ? { updated_at: serverRecord.updated_at } : {}) });
    } else if (current && serverRecord?.updated_at && !current.is_deleted && current.sync_operation === 'update') {
      // A newer edit made while this request was in flight builds on this accepted version.
      await db[tableName].update(snapshot.id, { updated_at: serverRecord.updated_at });
    } else if (current?.sync_operation === 'create' && !current.is_deleted) {
      // The row now exists remotely, but a newer local edit still needs sending.
      await db[tableName].update(snapshot.id, { sync_operation: 'update' });
    }
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function logSync({ record_id, table_name, status, error_msg = null }) {
  try {
    await db.sync_log.add({
      record_id,
      table_name,
      status,
      error_msg,
      attempted_at: new Date().toISOString(),
    });
  } catch (e) {
    // Non-critical — never let logging crash the sync
    console.warn('[SyncEngine] logSync error:', e);
  }
}

async function syncTable(tableName) {
  const pending = await db[tableName]
    .filter((r) => r.sync_status === 'pending')
    .toArray();

  if (pending.length === 0) return;

  const hasMutated = (oldRec, newRec) => {
    if (!newRec) return true;
    const keys = new Set([...Object.keys(oldRec), ...Object.keys(newRec)]);
    for (const k of keys) {
      if (k === 'sync_status' || k === 'synced') continue;
      if (oldRec[k] !== newRec[k]) return true;
    }
    return false;
  };

  // Separate soft-deleted vs normal upserts
  const toDelete = pending.filter((r) => r.is_deleted === true);
  const toUpdate = pending.filter(r => !r.is_deleted && r.sync_operation === 'update');
  const toUpsert = pending.filter((r) => r.is_deleted !== true && r.sync_operation !== 'update');
  const updateErrors = [];

  // Edits use UPDATE, never UPSERT: a missing/deleted cloud row cannot be recreated.
  for (const record of toUpdate) {
    const id = record.id;
    const changes = stripFields(record, ['synced', 'sync_status', 'sync_operation', 'id', 'created_at', 'event_id', 'type', 'seqNo', 'digitalReceiptNo', 'voucherNo', 'updated_at']);
    let request = supabase.from(tableName).update(changes).eq('id', id).or('is_deleted.is.null,is_deleted.eq.false');
    // Compare the server version when available; never overwrite a newer remote edit.
    if (record.updated_at) request = request.eq('updated_at', record.updated_at);
    if (record.event_id) request = request.eq('event_id', record.event_id);
    const { data, error } = await request.select('id,updated_at');
    if (error || !data?.length) {
      await db.transaction('rw', db[tableName], async () => {
        const current = await db[tableName].get(id);
        if (sameRecord(record, current)) await db[tableName].update(id, { sync_status: 'failed' });
      });
      updateErrors.push(error || new Error('Edited record changed, is missing/deleted, or cannot be updated. Edit retained locally.'));
      continue;
    }
    await settleSyncedRecord(tableName, record, data[0]);
  }

  // --- Handle soft-deleted records (Full Soft Delete) ---
  // Tombstone records are upserted to cloud with is_deleted=true.
  // They are NOT physically deleted from Supabase.
  // Other devices will detect is_deleted=true on next pull and remove locally.
  if (toDelete.length > 0) {
    const tombstones = toDelete.map(record => ({
      ...stripFields(record, ['sync_status', 'synced', 'sync_operation']),
      is_deleted: true,
    }));

    const { error: delError } = await supabase
      .from(tableName)
      .upsert(tombstones, { onConflict: 'id' });

    if (delError) {
      // Mark all tombstones as failed so retry picks them up
      await Promise.all(
        toDelete.map((r) =>
          db[tableName]
            .update(r.id, { sync_status: 'failed' })
            .then(() =>
              logSync({ record_id: r.id, table_name: tableName, status: 'failed', error_msg: delError.message })
            )
        )
      );
    } else {
      // Mark tombstones as synced — retain locally as tombstone, do NOT purge
      await Promise.all(
        toDelete.map(async (r) => {
          const current = await db[tableName].get(r.id);
          if (!hasMutated(r, current)) {
            await db[tableName].update(r.id, { sync_status: 'synced', synced: true });
            await logSync({ record_id: r.id, table_name: tableName, status: 'deleted' });
          } else {
            console.warn(`[SyncEngine] Record ${r.id} mutated during delete sync. Leaving as pending.`);
          }
        })
      );
    }
  }

  // --- Handle normal upserts ---
  if (toUpsert.length === 0) {
    if (updateErrors.length) throw updateErrors[0];
    return;
  }

  // Strip ALL local-only fields before sending to cloud
  const cloudRecords = toUpsert.map(record => stripFields(record, ['sync_status', 'is_deleted', 'synced', 'sync_operation']));

  const { data, error } = await supabase
    .from(tableName)
    .upsert(cloudRecords, { onConflict: 'id' }).select('id,updated_at');

  if (error) {
    // Mark all as failed
    await Promise.all(
      toUpsert.map((r) =>
        db.transaction('rw', db[tableName], async () => {
          if (sameRecord(r, await db[tableName].get(r.id))) await db[tableName].update(r.id, { sync_status: 'failed' });
        }).then(() =>
          logSync({ record_id: r.id, table_name: tableName, status: 'failed', error_msg: error.message })
        )
      )
    );
    throw error; // Bubble up so useSync can set global UI status
  }

  // Mark all as synced
  await Promise.all(
    toUpsert.map(async (r) => {
      await settleSyncedRecord(tableName, r, data?.find(row => row.id === r.id));
      await logSync({ record_id: r.id, table_name: tableName, status: 'synced' });
    })
  );
  if (updateErrors.length) throw updateErrors[0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push all records with sync_status='pending' across all tables to Supabase.
 * Keeps create/upsert and update-only edit operations distinct across retries.
 */
let activeSync = null;
let syncRequested = false;

export function syncPendingRecords() {
  syncRequested = true;
  if (!activeSync) {
    activeSync = (async () => {
      do {
        syncRequested = false;
        await runPendingSync();
      } while (syncRequested);
    })().finally(() => { activeSync = null; });
  }
  return activeSync;
}

async function runPendingSync() {
  if (!navigator.onLine) {
    console.log('[SyncEngine] Offline — skipping sync.');
    return;
  }

  const errors = [];
  for (const table of TABLES) {
    try {
      await syncTable(table);
    } catch (e) {
      errors.push({ table, error: e });
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Sync failed for: ${errors.map((e) => e.table).join(', ')}`
    );
  }
}

/**
 * Reset all sync_status='failed' records back to 'pending' and re-sync.
 */
export async function retryFailedRecords() {
  for (const table of TABLES) {
    const failed = await db[table]
      .filter((r) => r.sync_status === 'failed')
      .toArray();

    if (failed.length > 0) {
      await Promise.all(
        failed.map((r) => db[table].update(r.id, { sync_status: 'pending' }))
      );
    }
  }

  await syncPendingRecords();
}

/**
 * Returns counts of pending / synced / failed records across all tables.
 * Useful for SystemHealth display.
 */
export async function getSyncCounts() {
  let pending = 0, synced = 0, failed = 0;

  for (const table of TABLES) {
    const all = await db[table].toArray();
    for (const r of all) {
      if (r.sync_status === 'pending') pending++;
      else if (r.sync_status === 'failed') failed++;
      else synced++; // 'synced' or legacy records without the field
    }
  }

  return { pending, synced, failed };
}
