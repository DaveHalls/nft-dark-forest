'use client';

import { useState, useEffect } from 'react';
import { ipfsToHttp } from '@/config/ipfs';
import type { NFTMetadata } from '@/types/nft';

export function useNFTMetadata(metadataUri: string | null) {
  const [metadata, setMetadata] = useState<NFTMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!metadataUri) {
      setMetadata(null);
      return;
    }

    const fetchMetadata = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const httpUrl = ipfsToHttp(metadataUri);
        const response = await fetch(httpUrl);

        if (!response.ok) {
          throw new Error(`Failed to fetch metadata: ${response.statusText}`);
        }

        const data = await response.json();
        
        const processedMetadata: NFTMetadata = {
          ...data,
          image: ipfsToHttp(data.image),
        };

        setMetadata(processedMetadata);
      } catch (err: unknown) {
        console.error('Failed to fetch NFT metadata:', err);
        const message = err instanceof Error ? err.message : 'Failed to fetch metadata';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMetadata();
  }, [metadataUri]);

  return { metadata, isLoading, error };
}

