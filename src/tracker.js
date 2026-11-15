/** Deduplicate MAL recent-history events and aggregate daily contributions. */
import { createHash } from 'node:crypto';

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function datePartsInTimeZone(date, timeZone = BANGKOK_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function isoDateInTimeZone(date, timeZone = BANGKOK_TIME_ZONE) {
  const { year, month, day } = datePartsInTimeZone(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parse an ISO timestamp and return UTC instant plus Bangkok calendar date. */
export function parseMalDateTime(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let source = value.trim();
  // A timestamp without an explicit offset is treated as UTC for reproducibility.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(source)) source += 'Z';
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds)) return null;
  const instant = new Date(milliseconds);
  return {
    instant,
    date: isoDateInTimeZone(instant),
    // Canonical UTC timestamp with second precision keeps fingerprints stable.
    utcTimestamp: `${instant.toISOString().slice(0, 19)}+00:00`,
  };
}

function entryIdentity(row) {
  const entry = row.mal_url || row.entry || {};
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const value = entry.url || entry.mal_id || entry.id;
    if (value !== undefined && value !== null) return String(value).trim();
    return stableStringify(entry);
  }
  if (entry !== undefined && entry !== null) return String(entry).trim();
  return 'unknown-entry';
}

/** Normalize rows and assign stable SHA-256 fingerprints without storing titles. */
export function normalizeHistory(historyByKind) {
  const provisional = [];
  for (const kind of ['anime', 'manga']) {
    const rows = Array.isArray(historyByKind?.[kind]) ? historyByKind[kind] : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const rawIncrement = Number(row.increment ?? 0);
      if (!Number.isFinite(rawIncrement)) continue;
      const increment = Math.max(0, Math.trunc(rawIncrement));
      const timestamp = parseMalDateTime(row.date);
      if (increment <= 0 || timestamp === null) continue;
      const identity = `${kind}|${entryIdentity(row)}|${timestamp.utcTimestamp}|${increment}`;
      provisional.push({ kind, date: timestamp.date, increment, identity });
    }
  }

  // Use deterministic code-point ordering for stable fingerprints.
  provisional.sort((a, b) => {
    if (a.identity < b.identity) return -1;
    if (a.identity > b.identity) return 1;
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return 0;
  });

  const occurrences = new Map();
  return provisional.map((item) => {
    const duplicateNumber = occurrences.get(item.identity) ?? 0;
    occurrences.set(item.identity, duplicateNumber + 1);
    const fingerprint = createHash('sha256')
      .update(`${item.identity}|duplicate:${duplicateNumber}`, 'utf8')
      .digest('hex');
    return {
      kind: item.kind,
      date: item.date,
      increment: item.increment,
      fingerprint,
    };
  });
}

function bangkokIsoTimestamp(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+07:00`;
}

/** Import visible history once, then deduplicate overlapping history windows. */
export function applyHistory(state, historyByKind, now = new Date()) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('State must be a JSON object.');
  }
  if (!state.daily || typeof state.daily !== 'object' || Array.isArray(state.daily)) state.daily = {};
  if (!state.seen_events || typeof state.seen_events !== 'object' || Array.isArray(state.seen_events)) {
    state.seen_events = {};
  }

  const normalized = normalizeHistory(historyByKind);
  const added = { anime: 0, manga: 0 };
  const changedDays = new Set();
  let importedEvents = 0;

  for (const event of normalized) {
    if (Object.hasOwn(state.seen_events, event.fingerprint)) continue;
    const record = state.daily[event.date] ?? { anime: 0, manga: 0, total: 0 };
    record[event.kind] = Number(record[event.kind] ?? 0) + event.increment;
    record.total = Number(record.anime ?? 0) + Number(record.manga ?? 0);
    state.daily[event.date] = record;
    state.seen_events[event.fingerprint] = event.date;
    added[event.kind] += event.increment;
    importedEvents += 1;
    changedDays.add(event.date);
  }

  const firstImport = state.first_import_at == null;
  if (firstImport) state.first_import_at = bangkokIsoTimestamp(now);
  state.last_sync_at = bangkokIsoTimestamp(now);
  state.history_source = 'Toki public MAL history';

  return {
    state,
    summary: {
      first_import: firstImport,
      events_seen: normalized.length,
      events_added: importedEvents,
      anime_added: added.anime,
      manga_added: added.manga,
      days_changed: [...changedDays].sort(),
    },
  };
}

export { entryIdentity, isoDateInTimeZone, stableStringify };
