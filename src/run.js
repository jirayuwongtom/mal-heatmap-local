import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRecentHistory } from './collect.js';
import { applyHistory, parseMalDateTime } from './tracker.js';
import { checkHistoryHealth } from './health.js';
import { writeSite } from './render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validate the persisted ledger before any network request or write can occur. */
function validatePersistentState(state, username) {
  if (!isObjectRecord(state)) {
    throw new Error('state.json must contain a JSON object. Nothing was changed.');
  }
  if (state.schema_version !== 2) {
    throw new Error(`Unsupported state.json schema_version ${JSON.stringify(state.schema_version)}; expected 2. Nothing was changed.`);
  }
  if (state.username !== username) {
    throw new Error(
      `Configured username ${JSON.stringify(username)} does not match state.json username ` +
      `${JSON.stringify(state.username)}. Update data/state.json deliberately before switching accounts.`,
    );
  }
  if (!isObjectRecord(state.daily)) {
    throw new Error('state.json daily must be an object. Refusing to reset contribution history. Nothing was changed.');
  }
  if (!isObjectRecord(state.seen_events)) {
    throw new Error('state.json seen_events must be an object. Refusing to reset deduplication history. Nothing was changed.');
  }

  for (const [date, record] of Object.entries(state.daily)) {
    if (!isValidIsoDate(date)) {
      throw new Error(`state.json contains an invalid daily date key ${JSON.stringify(date)}. Nothing was changed.`);
    }
    if (!isObjectRecord(record)) {
      throw new Error(`state.json daily[${JSON.stringify(date)}] must be an object. Nothing was changed.`);
    }
    for (const field of ['anime', 'manga', 'total']) {
      if (!Number.isSafeInteger(record[field]) || record[field] < 0) {
        throw new Error(
          `state.json daily[${JSON.stringify(date)}].${field} must be a non-negative safe integer. ` +
          'Nothing was changed.',
        );
      }
    }
  }
}

/** Newest rows as "raw timestamp -> day counted", so date handling can be checked in the Actions log. */
function describeNewestRows(history, now, limit = 5) {
  return history.anime
    .map((row) => ({ row, parsed: parseMalDateTime(row?.date, now) }))
    .filter((item) => item.parsed !== null)
    .sort((a, b) => b.parsed.instant - a.parsed.instant)
    .slice(0, limit)
    // Titles and URLs are deliberately not printed: Actions logs of a public repo are public.
    .map(({ row, parsed }) => `  ${row.date} -> ${parsed.date} (Bangkok), +${Math.trunc(Number(row.increment ?? 0))} ep`);
}

/**
 * Collect, update state, render site. Every option exists so tests can run this against a fake
 * Toki and a temporary folder; the workflow calls it with no arguments and uses environment variables.
 */
export async function main(options = {}) {
  const env = options.env ?? process.env;
  const statePath = options.statePath ?? path.join(ROOT, 'data', 'state.json');
  const siteDir = options.siteDir ?? path.join(ROOT, 'site');
  const username = (options.username ?? env.MAL_USERNAME ?? 'TiMEZ4I3eth').trim();
  const tokiBaseUrl = (options.tokiBaseUrl ?? env.TOKI_BASE_URL ?? 'http://127.0.0.1:3000').trim();
  const now = options.now ?? new Date();
  const log = options.log ?? console.log;
  // GitHub Actions turns "::warning::..." lines into annotations on the run summary.
  const warn = options.warn ?? console.log;
  const allowEmpty = env.ALLOW_EMPTY_HISTORY === '1';

  const rawState = await fs.readFile(statePath, 'utf8');
  const state = JSON.parse(rawState);
  validatePersistentState(state, username);

  // Fetch successfully before changing state. This avoids a partial sync.
  const history = await collectRecentHistory(
    username,
    tokiBaseUrl,
    options.fetchImpl ?? globalThis.fetch,
    options.collectOptions ?? {},
  );

  // Refuse a response that looks broken instead of "succeeding" while importing nothing.
  const health = checkHistoryHealth(state, history, now);
  if (health.error) {
    if (allowEmpty && history.anime.length === 0) {
      warn(`::warning::${health.error} (continuing because ALLOW_EMPTY_HISTORY=1)`);
    } else {
      throw new Error(`${health.error} Nothing was changed. (Set ALLOW_EMPTY_HISTORY=1 only if an empty history is expected.)`);
    }
  }
  for (const warning of health.warnings) warn(`::warning::${warning}`);

  const { state: updatedState, summary } = applyHistory(state, history, now);
  // Only touch the file when something changed, so the workflow does not create empty commits.
  const nextRawState = `${JSON.stringify(updatedState, null, 2)}\n`;
  const stateChanged = nextRawState !== rawState.replace(/\r\n/g, '\n');
  if (stateChanged) {
    // Temp file + rename: a crash can never leave a half-written state.json.
    const tempPath = `${statePath}.tmp`;
    await fs.writeFile(tempPath, nextRawState, 'utf8');
    await fs.rename(tempPath, statePath);
  }

  const repository = (options.repository ?? env.GITHUB_REPOSITORY ?? '').trim();
  await writeSite(updatedState, username, siteDir, { repository, now });

  log(`MAL account: ${username}`);
  log(`State file changed: ${stateChanged ? 'yes' : 'no'}`);
  log(`Recent anime history rows returned: ${history.anime.length}`);
  const newest = describeNewestRows(history, now);
  if (newest.length > 0) {
    log('Newest history rows (raw timestamp from Toki -> day counted):');
    for (const line of newest) log(line);
  }
  log(`Previously unseen history events imported: ${summary.events_added}`);
  log(`Anime episodes added: ${summary.anime_added}`);
  log(`Contribution dates changed: ${summary.days_changed.join(', ') || 'none'}`);
  if (summary.first_import) {
    log('First import complete: all history currently exposed by MAL was backfilled.');
  }
  log('Only aggregate daily totals and hashed event fingerprints are stored in the repository.');
  return { stateChanged, summary, health };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${(error.message ?? String(error)).split('\n')[0]}`);
    console.error(error.stack ?? error.message ?? String(error));
    process.exitCode = 1;
  });
}
