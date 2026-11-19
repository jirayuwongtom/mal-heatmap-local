/**
 * Sanity checks that turn "silently recorded nothing" into a loud failure.
 * MAL only exposes ~21 days of history, so an unnoticed outage longer than that loses data.
 */
import { isoDateInTimeZone, parseMalDateTime } from './tracker.js';

// Keep a one-day margin inside MAL's roughly 21-day public-history window.
const RECENT_DAYS = 20;

function addDays(iso, count) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDateInTimeZone(new Date(Date.UTC(y, m - 1, d + count, 12)), 'UTC');
}

/**
 * @returns {{ error: string | null, warnings: string[] }}
 *  error    -> the run must fail (state is not written)
 *  warnings -> printed as GitHub Actions ::warning:: annotations
 */
export function checkHistoryHealth(state, history, now = new Date()) {
  const rows = Array.isArray(history?.anime) ? history.anime : [];
  const warnings = [];
  const today = isoDateInTimeZone(now);

  if (rows.length === 0) {
    // Days we already counted recently must still be visible in MAL's ~21-day history window.
    const cutoff = addDays(today, -RECENT_DAYS);
    const recent = Object.entries(state?.daily ?? {})
      .filter(([date, rec]) => date >= cutoff && date <= today && Number(rec?.anime ?? 0) > 0)
      .map(([date]) => date)
      .sort();
    if (recent.length > 0) {
      return {
        error:
          `Toki returned 0 history rows, but state.json has anime activity in the last ${RECENT_DAYS} days ` +
          `(${recent.join(', ')}). MAL probably changed its page, hid the history or blocked the runner. ` +
          'Refusing to treat this as a successful sync.',
        warnings,
      };
    }
    warnings.push('Toki returned 0 history rows. This is normal only if nothing was watched in ~21 days.');
    return { error: null, warnings };
  }

  const unparseable = rows.filter((row) => parseMalDateTime(row?.date, now) === null).length;
  if (unparseable === rows.length) {
    return {
      error:
        `None of the ${rows.length} history rows has a readable date. Toki's response format or date ` +
        'parsing has probably changed; refusing to continue.',
      warnings,
    };
  }

  // Toki's documented schema permits date=null, but a non-null, unparsable string means its
  // timestamp format has changed. Do not import only part of the response in that case.
  const invalidDateStrings = rows.filter((row) => row?.date !== null && parseMalDateTime(row?.date, now) === null).length;
  if (invalidDateStrings > 0) {
    return {
      error:
        `${invalidDateStrings} of ${rows.length} history rows had an invalid non-null date. ` +
        "Toki's timestamp format may have changed; refusing to import a partial response.",
      warnings,
    };
  }

  const missingDates = rows.filter((row) => row?.date === null).length;
  if (missingDates > 0) warnings.push(`${missingDates} of ${rows.length} history rows had date=null and were skipped.`);
  return { error: null, warnings };
}
