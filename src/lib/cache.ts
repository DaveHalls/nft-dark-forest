export type CacheEnvelope<T> = {
  v: number;
  at: number;
  ttl?: number;
  data: T;
};

const NS = 'app:nftdf';
const VERSION = 1;

export function makeKey(parts: Array<string | number>) {
  return `${NS}:v${VERSION}:${parts.join(':')}`;
}

export function setJSON<T>(key: string, data: T, ttlSec?: number) {
  const payload: CacheEnvelope<T> = { v: VERSION, at: Date.now(), ttl: ttlSec, data };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {}
}

export function getJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== VERSION) return null;
    if (parsed.ttl && Date.now() - parsed.at > parsed.ttl * 1000) return null;
    return parsed.data as T;
  } catch {
    return null;
  }
}

export function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}


