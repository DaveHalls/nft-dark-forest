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
        const { initSDK } = await import('@zama-fhe/relayer-sdk/bundle');
        await initSDK();
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

