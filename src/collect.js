/**
 * Fetch public MyAnimeList recent-history events from a local Toki instance.
 * Toki is started temporarily by GitHub Actions; it is not the official MAL API.
 */

export class HistorySourceError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'HistorySourceError';
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

function isTransientStatus(status) {
  return [429, 502, 503, 504].includes(status);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch all currently visible public history rows for one MAL content type. */
export async function fetchUserHistory(
  username,
  kind,
  tokiBaseUrl = 'http://127.0.0.1:3000',
  fetchImpl = globalThis.fetch,
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(45_000),
      });

      if (isTransientStatus(response.status)) {
        throw new HistorySourceError(
          `Toki/MAL temporarily returned HTTP ${response.status} for ${kind}.`,
        );
      }
      if ([401, 403].includes(response.status)) {
        throw new HistorySourceError(
          `Toki/MAL returned HTTP ${response.status} for ${kind}. ` +
          'Check that the MAL profile and history are public; MAL may also be throttling requests.',
        );
      }
      if (response.status === 404) {
        throw new HistorySourceError(
          `Toki could not find public history for MAL user ${JSON.stringify(username)} (${kind}).`,
        );
      }
      if (!response.ok) {
        const body = (await response.text()).slice(0, 240);
        throw new HistorySourceError(`Toki returned HTTP ${response.status} for ${kind}: ${body}`);
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
        (error instanceof HistorySourceError && /HTTP (429|502|503|504)/.test(error.message));
      if (!transient || attempt === 2) break;
      await sleep(2 ** attempt * 1000);
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
) {
  const anime = await fetchUserHistory(username, 'anime', tokiBaseUrl, fetchImpl);
  return { anime, manga: [] };
}

export { decodeHistoryPayload };
