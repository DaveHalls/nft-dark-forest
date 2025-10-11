'use client';

import Script from 'next/script';

export default function FheScriptLoader() {
  return (
    <Script
      src="https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs"
      strategy="beforeInteractive"
      crossOrigin="anonymous"
    />
  );
}

