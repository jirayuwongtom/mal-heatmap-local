/**
 * Fetch public MyAnimeList recent-history events from a local Toki instance.
 * Toki is started temporarily by GitHub Actions; it is not the official MAL API.
 */

export class HistorySourceError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown, status?: number, retryAfterMs?: number}} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HistorySourceError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function decodeHistoryPayload(payload, kind) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if (payload.error) {
      throw new HistorySourceError(`Toki returned an error for ${kind}: ${payload.error}`);
    }
    payload = payload.data;
  }

  if (!Array.isArray(payload)) {
    throw new HistorySourceError(
      `Unexpected Toki response for ${kind}: expected a JSON array of history events.`,
    );
  }

  return payload.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

// Toki forwards MAL's HTTP status (429/403/404...) and uses 500 for its own network/parse errors,
// so 500 is retried too (cheap: short delays).
const MAX_ATTEMPTS = 4;
const TRANSIENT_STATUSES = [429, 500, 502, 503, 504];
const SERVER_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];
// MAL rate limits need real cool-down time; 1-2 seconds is not enough.
const RATE_LIMIT_RETRY_DELAYS_MS = [30_000, 60_000, 90_000];
const MAX_RETRY_AFTER_MS = 120_000;

function isTransientStatus(status) {
  return TRANSIENT_STATUSES.includes(status);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a Retry-After header given in seconds. Returns milliseconds or undefined. */
function parseRetryAfterMs(response) {
  const raw = response?.headers?.get?.('retry-after');
  const seconds = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/** How long to wait before the next attempt, given the error that just happened. */
export function retryDelayMs(error, attemptIndex) {
  if (error?.status === 429) {
    return error.retryAfterMs ?? RATE_LIMIT_RETRY_DELAYS_MS[Math.min(attemptIndex, RATE_LIMIT_RETRY_DELAYS_MS.length - 1)];
  }
  return SERVER_RETRY_DELAYS_MS[Math.min(attemptIndex, SERVER_RETRY_DELAYS_MS.length - 1)];
}

/** Fetch all currently visible public history rows for one MAL content type. */
export async function fetchUserHistory(
  username,
  kind,
  tokiBaseUrl = 'http://127.0.0.1:3000',
  fetchImpl = globalThis.fetch,
  { sleepImpl = sleep } = {},
) {
  if (!['anime', 'manga'].includes(kind)) {
    throw new TypeError("kind must be 'anime' or 'manga'");
  }
  if (typeof fetchImpl !== 'function') {
    throw new HistorySourceError('This Node.js version does not provide fetch(). Use Node.js 22 or newer.');
  }

  const base = String(tokiBaseUrl).replace(/\/+$/, '');
  const url = new URL(`${base}/users/${encodeURIComponent(username)}/history`);
  url.searchParams.set('type', kind);
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'MAL-Contributions/3.0 (personal GitHub Actions project)',
  };

  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(45_000),
      });

      if (isTransientStatus(response.status)) {
        throw new HistorySourceError(
          `Toki/MAL temporarily returned HTTP ${response.status} for ${kind}.`,
          { status: response.status, retryAfterMs: parseRetryAfterMs(response) },
        );
      }
      if ([401, 403].includes(response.status)) {
        throw new HistorySourceError(
          `Toki/MAL returned HTTP ${response.status} for ${kind}. ` +
          'Check that the MAL profile and history are public; MAL may also be throttling requests.',
          { status: response.status },
        );
      }
      if (response.status === 404) {
        throw new HistorySourceError(
          `Toki could not find public history for MAL user ${JSON.stringify(username)} (${kind}).`,
          { status: 404 },
        );
      }
      if (!response.ok) {
        const body = (await response.text()).slice(0, 240);
        throw new HistorySourceError(
          `Toki returned HTTP ${response.status} for ${kind}: ${body}`,
          { status: response.status },
        );
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new HistorySourceError(`Toki returned invalid JSON for ${kind}.`, { cause: error });
      }
      return decodeHistoryPayload(payload, kind);
    } catch (error) {
      lastError = error;
      const transient = error.name === 'TypeError' ||
        error.name === 'TimeoutError' ||
        error.name === 'AbortError' ||
        (error instanceof HistorySourceError && isTransientStatus(error.status));
      if (!transient || attempt === MAX_ATTEMPTS - 1) break;
      const delay = retryDelayMs(error, attempt);
      console.warn(`Attempt ${attempt + 1}/${MAX_ATTEMPTS} failed (${error.message}); retrying in ${Math.round(delay / 1000)}s.`);
      await sleepImpl(delay);
    }
  }

  if (lastError instanceof HistorySourceError) throw lastError;
  throw new HistorySourceError(
    `Could not fetch MAL ${kind} history: ${lastError?.message ?? 'unknown network error'}`,
    { cause: lastError },
  );
}

/**
 * Fetch Anime history only. Manga is intentionally not collected: the calendar counts watched
 * anime episodes. The `manga` key is kept (empty) so the shape stays compatible with the tracker.
 */
export async function collectRecentHistory(
  username,
  tokiBaseUrl = 'http://127.0.0.1:3000',
  fetchImpl = globalThis.fetch,
  options = {},
) {
  const anime = await fetchUserHistory(username, 'anime', tokiBaseUrl, fetchImpl, options);
  return { anime, manga: [] };
}

export { decodeHistoryPayload };
