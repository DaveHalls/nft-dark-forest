'use client';

import { useState, useEffect, useRef } from 'react';
import { useWalletContext } from '@/contexts/WalletContext';
import { useFhe } from '@/contexts/FheContext';
import { initFhevm } from '@/fhevm/fhe-client';
import { CONTRACT_ADDRESSES } from '@/config/contracts';
import { DEFAULT_CHAIN } from '@/config/chains';

export function useFheInstance() {
  const { provider, isConnected, chainId, switchChain } = useWalletContext();
  const { isInitialized: sdkInitialized } = useFhe();
  const [instance, setInstance] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsNetworkSwitch, setNeedsNetworkSwitch] = useState(false);
  const isInitializingRef = useRef(false);

  useEffect(() => {
    if (chainId !== DEFAULT_CHAIN.chainId) {
      setNeedsNetworkSwitch(true);
    } else {
      setNeedsNetworkSwitch(false);
    }
  }, [chainId]);

  useEffect(() => {
    const createFheInstance = async () => {
      if (!sdkInitialized || !isConnected || !provider) {
        setInstance(null);
        setError(null);
        return;
      }

      if (instance && !isInitializingRef.current) {
        return;
      }

      if (isInitializingRef.current) {
        return;
      }

      isInitializingRef.current = true;

      try {
        setIsLoading(true);
        setError(null);

        const gatewayUrl = CONTRACT_ADDRESSES.GATEWAY;

        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_CHAIN.rpcUrls[0];
        if (!rpcUrl) {
          setInstance(null);
          throw new Error('No RPC URL configured');
        }

        const targetChainId = parseInt(DEFAULT_CHAIN.chainId.startsWith('0x') ? DEFAULT_CHAIN.chainId.slice(2) : DEFAULT_CHAIN.chainId, 16);

        const fheInstance = await initFhevm(
          rpcUrl,
          targetChainId,
          gatewayUrl
        );

        setInstance(fheInstance);
      } catch (err: unknown) {
        console.error('Failed to create FHE instance:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        let friendlyMessage = 'Failed to create FHE instance';
        if (errorMessage.includes('Too Many Requests') || errorMessage.includes('-32005')) {
          friendlyMessage = 'RPC rate limit reached. Please configure your own RPC URL or wait a moment';
        } else if (errorMessage.includes('BAD_DATA')) {
          friendlyMessage = 'Failed to connect to blockchain. Please check your network connection';
        }
        
        setError(friendlyMessage);
        setInstance(null);
      } finally {
        setIsLoading(false);
        isInitializingRef.current = false;
      }
    };

    createFheInstance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkInitialized, isConnected, chainId]);

  const handleSwitchNetwork = async () => {
    try {
      await switchChain();
      setNeedsNetworkSwitch(false);
      setError(null);
    } catch (err: unknown) {
      console.error('Failed to switch network:', err);
      const message = err instanceof Error ? err.message : 'Failed to switch network';
      setError(message);
    }
  };

  return {
    instance,
    isLoading,
    error,
    isReady: !!instance && !isLoading,
    needsNetworkSwitch,
    switchNetwork: handleSwitchNetwork,
  };
}

