/** Deduplicate MAL recent-history events and aggregate daily contributions. */
import { createHash } from 'node:crypto';

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

// Historical baseline is curated from the user's 2026 watch log. Automatic MAL imports
// must never add events before this date. The pre-cutoff 2026 entries remain as baseline data.
export const AUTO_SYNC_START_DATE = '2026-10-26';

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

const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * MAL prints older history rows without a year ("Dec 28, 5:03 PM") and Toki fills in the current
 * year. Around New Year that puts December rows in the future. A real history event can never be
 * in the future, so such a timestamp is moved back one year. This runs before fingerprinting, so
 * fingerprints stay identical to the ones created in December.
 */
export function correctFutureYear(instant, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return { instant, corrected: false };
  if (instant.getTime() <= now.getTime() + FUTURE_TOLERANCE_MS) return { instant, corrected: false };
  const earlier = new Date(instant);
  earlier.setUTCFullYear(earlier.getUTCFullYear() - 1);
  return { instant: earlier, corrected: true };
}

/**
 * Parse an ISO timestamp and return UTC instant plus Bangkok calendar date.
 * When `now` is given, timestamps in the future are assumed to be missing-year rows and are moved
 * back one year (see correctFutureYear).
 */
export function parseMalDateTime(value, now = null) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let source = value.trim();
  // A timestamp without an explicit offset is treated as UTC for reproducibility.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(source)) source += 'Z';
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds)) return null;
  const { instant, corrected } = correctFutureYear(new Date(milliseconds), now);
  return {
    year_corrected: corrected,
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

/**
 * Normalize rows and assign stable SHA-256 fingerprints without storing titles.
 *
 * `fingerprint` (current) identifies an event by anime + Bangkok calendar DATE + increment. The
 * time of day is deliberately NOT part of it: the calendar only cares which day an episode was
 * watched, so a differently-rounded or re-resolved clock time ("Today, 3:05 PM" vs "Nov 18, 3:05 PM")
 * can never turn the same event into a "new" one.
 * `legacyFingerprint` is the old time-of-day based hash. It is only used to recognise events that
 * were stored before the date-based fingerprint existed, so upgrading never re-counts old history.
 */
export function normalizeHistory(historyByKind, now = new Date(), minimumDate = AUTO_SYNC_START_DATE) {
  if (typeof minimumDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(minimumDate)) {
    throw new TypeError('minimumDate must be a valid YYYY-MM-DD date.');
  }
  const parsedMinimumDate = new Date(`${minimumDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsedMinimumDate.getTime()) || parsedMinimumDate.toISOString().slice(0, 10) !== minimumDate) {
    throw new TypeError('minimumDate must be a valid YYYY-MM-DD date.');
  }
  const provisional = [];
  // Only anime episodes are counted; any manga rows passed in are ignored.
  for (const kind of ['anime']) {
    const rows = Array.isArray(historyByKind?.[kind]) ? historyByKind[kind] : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const rawIncrement = Number(row.increment ?? 0);
      if (!Number.isFinite(rawIncrement)) continue;
      const increment = Math.max(0, Math.trunc(rawIncrement));
      const timestamp = parseMalDateTime(row.date, now);
      if (increment <= 0 || timestamp === null || timestamp.date < minimumDate) continue;
      const entry = entryIdentity(row);
      provisional.push({
        kind,
        date: timestamp.date,
        increment,
        identity: `v2|${kind}|${entry}|${timestamp.date}|${increment}`,
        legacyIdentity: `${kind}|${entry}|${timestamp.utcTimestamp}|${increment}`,
      });
    }
  }

  // Use deterministic code-point ordering for stable fingerprints.
  provisional.sort((a, b) => {
    if (a.identity < b.identity) return -1;
    if (a.identity > b.identity) return 1;
    if (a.legacyIdentity < b.legacyIdentity) return -1;
    if (a.legacyIdentity > b.legacyIdentity) return 1;
    return 0;
  });

  const occurrences = new Map();
  const legacyOccurrences = new Map();
  const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
  return provisional.map((item) => {
    const duplicateNumber = occurrences.get(item.identity) ?? 0;
    occurrences.set(item.identity, duplicateNumber + 1);
    const legacyDuplicate = legacyOccurrences.get(item.legacyIdentity) ?? 0;
    legacyOccurrences.set(item.legacyIdentity, legacyDuplicate + 1);
    return {
      kind: item.kind,
      date: item.date,
      increment: item.increment,
      fingerprint: hash(`${item.identity}|duplicate:${duplicateNumber}`),
      legacyFingerprint: hash(`${item.legacyIdentity}|duplicate:${legacyDuplicate}`),
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
  // Never replace damaged containers with empty objects: that would silently discard the
  // historical totals or deduplication ledger and could count old MAL rows again.
  if (!state.daily || typeof state.daily !== 'object' || Array.isArray(state.daily)) {
    throw new TypeError('State.daily must be an object; refusing to reset contribution history.');
  }
  if (!state.seen_events || typeof state.seen_events !== 'object' || Array.isArray(state.seen_events)) {
    throw new TypeError('State.seen_events must be an object; refusing to reset deduplication history.');
  }

  const minimumDate = state.auto_sync_start_date ?? AUTO_SYNC_START_DATE;
  const normalized = normalizeHistory(historyByKind, now, minimumDate);
  const added = { anime: 0, manga: 0 };
  const changedDays = new Set();
  let importedEvents = 0;

  for (const event of normalized) {
    if (Object.hasOwn(state.seen_events, event.fingerprint)) continue;
    // Imported by an older version of this tracker (time-of-day fingerprint): already counted.
    // Remember it under the date-based fingerprint too, so later runs no longer depend on the clock time.
    if (Object.hasOwn(state.seen_events, event.legacyFingerprint)) {
      state.seen_events[event.fingerprint] = event.date;
      continue;
    }
    const record = state.daily[event.date] ?? { anime: 0, manga: 0, total: 0 };
    record[event.kind] = Number(record[event.kind] ?? 0) + event.increment;
    record.total = Number(record.anime ?? 0);
    state.daily[event.date] = record;
    state.seen_events[event.fingerprint] = event.date;
    added[event.kind] += event.increment;
    importedEvents += 1;
    changedDays.add(event.date);
  }

  const firstImport = state.first_import_at == null;
  if (firstImport) state.first_import_at = bangkokIsoTimestamp(now);
  // The state file must only change when the data changes; otherwise every scheduled run would
  // create a commit. The time of the last run lives in site/activity.json (generated_at) instead.
  delete state.last_sync_at;
  if (firstImport || importedEvents > 0) state.last_change_at = bangkokIsoTimestamp(now);
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
