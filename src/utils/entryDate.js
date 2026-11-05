export function validEntryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function readEntryDate(key, fallback, storage) {
  try {
    const value = (storage ?? globalThis.sessionStorage).getItem(`dawa:entry-date:${key}`);
    return validEntryDate(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeEntryDate(key, value, storage) {
  if (!validEntryDate(value)) return;
  try {
    (storage ?? globalThis.sessionStorage).setItem(`dawa:entry-date:${key}`, value);
  } catch {
    // Storage can be unavailable; the form still keeps its in-memory date.
  }
}

export function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
