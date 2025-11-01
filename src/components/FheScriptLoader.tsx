'use client';

import Script from 'next/script';

export default function FheScriptLoader() {
  return (
    <Script
      src="https://cdn.zama.org/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs"
      strategy="afterInteractive"
      crossOrigin="anonymous"
    />
  );
}

