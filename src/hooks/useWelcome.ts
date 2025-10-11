'use client';

import { useState, useEffect } from 'react';

export function useWelcome() {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setTimeout(() => {
      setShowWelcome(true);
    }, 500);
  }, []);

  const closeWelcome = () => {
    setShowWelcome(false);
  };

  const resetWelcome = () => {
    setShowWelcome(true);
  };

  return {
    showWelcome,
    closeWelcome,
    resetWelcome,
  };
}

