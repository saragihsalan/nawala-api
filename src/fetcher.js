import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- config (reload otomatis saat config.json berubah) ----------
let configCache = { data: null, mtimeMs: 0 };

export function loadConfig() {
  try {
    const p = path.join(__dirname, '..', 'config.json');
    const stat = statSync(p);
    if (!configCache.data || stat.mtimeMs !== configCache.mtimeMs) {
      configCache.data = JSON.parse(readFileSync(p, 'utf8'));
      configCache.mtimeMs = stat.mtimeMs;
    }
    return configCache.data;
  } catch {
    return configCache.data || {};
  }
}

// ---------- cache in-memory ----------
const cache = new Map();

export function cacheGet(key) {
  const cfg = loadConfig();
  if (cfg.cache && cfg.cache.enabled === false) return null;
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.exp) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

export function cacheSet(key, value, ttl) {
  const cfg = loadConfig();
  if (cfg.cache && cfg.cache.enabled === false) return;
  cache.set(key, { value, exp: Date.now() + ttl * 1000 });
  const max = cfg.cache?.maxEntries || 5000;
  if (cache.size > max) {
    for (const k of cache.keys()) {
      if (cache.size <= max) break;
      cache.delete(k);
    }
  }
}

export function cacheClear() {
  cache.clear();
}

export function cacheStats() {
  return { entries: cache.size };
}
