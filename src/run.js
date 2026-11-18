import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRecentHistory } from './collect.js';
import {
  applyHistory,
  parseMalDateTime
} from './tracker.js';
import { writeSite } from './render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = path.join(ROOT, 'data', 'state.json');
const USERNAME = (process.env.MAL_USERNAME ?? 'TiMEZ4I3eth').trim();
const TOKI_BASE_URL = (process.env.TOKI_BASE_URL ?? 'http://127.0.0.1:3000').trim();

export async function main() {
  const state = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  if (state.username !== USERNAME) {
    throw new Error(
      `Configured username ${JSON.stringify(USERNAME)} does not match state.json username ` +
      `${JSON.stringify(state.username)}. Update data/state.json deliberately before switching accounts.`,
    );
  }
  for (const [index, row] of history.anime.entries()) {
  const parsed = parseMalDateTime(row.date);

  console.log('[MAL-DIAG]', JSON.stringify({
    index,
    mal_id: row.mal_url?.mal_id,
    url: row.mal_url?.url,
    increment: row.increment,
    raw_date: row.date,
    bangkok_date: parsed?.date ?? null,
    utc_timestamp: parsed?.utcTimestamp ?? null
  }));
}
  // Fetch successfully before changing state. This avoids a partial sync.
  const history = await collectRecentHistory(USERNAME, TOKI_BASE_URL);
  const { state: updatedState, summary } = applyHistory(state, history, new Date());
  await fs.writeFile(STATE_PATH, `${JSON.stringify(updatedState, null, 2)}\n`, 'utf8');

  const repository = (process.env.GITHUB_REPOSITORY ?? '').trim();
  await writeSite(updatedState, USERNAME, path.join(ROOT, 'site'), { repository });

  console.log(`MAL account: ${USERNAME}`);
  console.log(`Recent anime history rows returned: ${history.anime.length}`);
  console.log(`Previously unseen history events imported: ${summary.events_added}`);
  console.log(`Anime episodes added: ${summary.anime_added}`);
  console.log(`Contribution dates changed: ${summary.days_changed.join(', ') || 'none'}`);
  if (summary.first_import) {
    console.log('First import complete: all history currently exposed by MAL was backfilled.');
  }
  console.log('Only aggregate daily totals and hashed event fingerprints are stored in the repository.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error.message ?? String(error));
    process.exitCode = 1;
  });
}
