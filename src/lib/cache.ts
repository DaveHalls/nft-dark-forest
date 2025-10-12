export type CacheEnvelope<T> = {
  v: number;
  at: number;
  ttl?: number;
  data: T;
};

const NS = 'app:nftdf';
const VERSION = 1;

// Fallback in-memory store when localStorage is unavailable or fails
const memoryStore = new Map<string, CacheEnvelope<unknown>>();

let storageUsable: boolean | null = null;
function isLocalStorageAvailable(): boolean {
  if (storageUsable !== null) return storageUsable;
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      storageUsable = false;
      return storageUsable;
    }
    const testKey = `${NS}:__test__`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    storageUsable = true;
  } catch {
    storageUsable = false;
  }
  return storageUsable;
}

export function makeKey(parts: Array<string | number>) {
  return `${NS}:v${VERSION}:${parts.join(':')}`;
}

export function setJSON<T>(key: string, data: T, ttlSec?: number) {
  const payload: CacheEnvelope<T> = { v: VERSION, at: Date.now(), ttl: ttlSec, data };
  try {
    if (isLocalStorageAvailable()) {
      localStorage.setItem(key, JSON.stringify(payload));
    } else {
      memoryStore.set(key, payload);
    }
  } catch {
    // If localStorage write fails (e.g., quota exceeded), fall back to memory
    try { memoryStore.set(key, payload); } catch {}
  }
}

export function getJSON<T>(key: string): T | null {
  try {
    if (isLocalStorageAvailable()) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as CacheEnvelope<T>;
          if (!parsed || typeof parsed !== 'object') return null;
          if (parsed.v !== VERSION) return null;
          if (parsed.ttl && Date.now() - parsed.at > parsed.ttl * 1000) {
            // Clean up expired entry to free space
            try { localStorage.removeItem(key); } catch {}
            return null;
          }
          return parsed.data as T;
        } catch {
          // Corrupted payload
          try { localStorage.removeItem(key); } catch {}
          return null;
        }
      }
    }
    // Fallback: read from memory store
    const mem = memoryStore.get(key) as CacheEnvelope<T> | undefined;
    if (!mem) return null;
    if (mem.v !== VERSION) return null;
    if (mem.ttl && Date.now() - mem.at > mem.ttl * 1000) {
      try { memoryStore.delete(key); } catch {}
      return null;
    }
    return mem.data as T;
  } catch {
    return null;
  }
}

export function remove(key: string) {
  try {
    if (isLocalStorageAvailable()) {
      localStorage.removeItem(key);
    }
  } catch {} finally {
    try { memoryStore.delete(key); } catch {}
  }
}


