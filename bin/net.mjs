import https from 'node:https';
import { execSync } from 'node:child_process';

export class HttpError extends Error {
  constructor(status, url, body, retryAfterSeconds) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NET_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED']);

export function isTransientError(err) {
  if (err instanceof HttpError) return TRANSIENT_HTTP_STATUSES.has(err.status);
  return TRANSIENT_NET_CODES.has(err.code);
}

export async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    label,
    shouldRetry = isTransientError,
  } = opts;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (attempt > retries || !shouldRetry(err)) throw err;
      const hintMs = err.retryAfterSeconds != null ? err.retryAfterSeconds * 1000 : null;
      const backoffMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = hintMs ?? backoffMs;
      const reason = err.status ? `HTTP ${err.status}` : (err.code || err.message.split('\n')[0].slice(0, 80));
      const prefix = label ? `${label}: ` : '';
      console.log(`  ${prefix}${reason} — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${retries + 1})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

function getGithubToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execSync('gh auth token', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function httpsGetJsonOnce(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error(`Too many redirects fetching ${url}`));
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'agentstack-installer' };
    const token = url.includes('api.github.com') ? getGithubToken() : null;
    if (token) headers['Authorization'] = `token ${token}`;
    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetJsonOnce(res.headers.location, redirects + 1).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const retryAfter = parseInt(res.headers['retry-after'], 10);
          reject(new HttpError(res.statusCode, url, data, Number.isFinite(retryAfter) ? retryAfter : undefined));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

export function httpsGetJson(url, retryOpts = {}) {
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  return withRetry(() => httpsGetJsonOnce(url), { label: `GET ${host}`, ...retryOpts });
}

export async function getGithubLatestTag(repo) {
  try {
    const release = await httpsGetJson(`https://api.github.com/repos/${repo}/releases/latest`);
    return release.tag_name?.replace(/^v/, '') || null;
  } catch {
    return null;
  }
}
