'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface FheContextType {
  isInitialized: boolean;
  error: string | null;
}

const FheContext = createContext<FheContextType | null>(null);

export function FheProvider({ children }: { children: ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initFhe = async () => {
      if (typeof window === 'undefined') return;

      try {
        let initFn: (() => Promise<unknown>) | null = null;

        const tryGetGlobal = () => {
          const w = window as unknown as Record<string, unknown>;
          const candidates = [
            (w.RelayerSDK as { initSDK?: () => Promise<unknown> } | undefined)?.initSDK,
            (w.relayerSDK as { initSDK?: () => Promise<unknown> } | undefined)?.initSDK,
            (w.zamaRelayerSDK as { initSDK?: () => Promise<unknown> } | undefined)?.initSDK,
          ];
          return candidates.find((fn): fn is () => Promise<unknown> => typeof fn === 'function') ?? null;
        };

        initFn = tryGetGlobal();

        if (!initFn) {
          for (let i = 0; i < 50; i += 1) {
            await new Promise((r) => setTimeout(r, 100));
            initFn = tryGetGlobal();
            if (initFn) break;
          }
        }

        if (!initFn) {
          try {
            const mod = (await import('@zama-fhe/relayer-sdk/bundle')) as unknown;
            const maybe = mod as { initSDK?: () => Promise<unknown> };
            if (maybe && typeof maybe.initSDK === 'function') {
              initFn = maybe.initSDK;
            }
          } catch {
            // ignore and raise below
          }
        }

        if (!initFn) {
          throw new Error('Relayer SDK not loaded. Please check CDN availability or dependency installation.');
        }

        await initFn();
        setIsInitialized(true);
      } catch (err) {
        console.error('FHE SDK initialization failed:', err);
        const message = err instanceof Error ? err.message : 'FHE SDK initialization failed';
        setError(message);
      }
    };

    initFhe();
  }, []);

  return (
    <FheContext.Provider value={{ isInitialized, error }}>
      {children}
    </FheContext.Provider>
  );
}

export function useFhe() {
  const context = useContext(FheContext);
  if (!context) {
    throw new Error('useFhe must be used within FheProvider');
  }
  return context;
}

