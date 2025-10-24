'use client';

import { useEffect } from 'react';

export default function GlobalErrorHandler() {
  useEffect(() => {
    const originalError = console.error;
    
    console.error = (...args: unknown[]) => {
      const errorStr = String(args[0] || '');
      
      if (
        errorStr.includes('filter not found') ||
        errorStr.includes('eth_getFilterChanges') ||
        (errorStr.includes('could not coalesce error') && errorStr.includes('filter'))
      ) {
        return;
      }
      
      originalError.apply(console, args);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      if (
        errorMsg.includes('filter not found') ||
        errorMsg.includes('eth_getFilterChanges')
      ) {
        event.preventDefault();
        return;
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      console.error = originalError;
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}

