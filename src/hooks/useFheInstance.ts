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
  const lastChainIdRef = useRef<string | null>(null);

  useEffect(() => {
    const createFheInstance = async () => {
      if (!sdkInitialized || !isConnected || !provider) {
        setInstance(null);
        lastChainIdRef.current = null;
        return;
      }

      if (chainId !== DEFAULT_CHAIN.chainId) {
        setNeedsNetworkSwitch(true);
        setError(`Please switch to ${DEFAULT_CHAIN.chainName} network`);
        return;
      }

      if (instance && chainId === lastChainIdRef.current && !isInitializingRef.current) {
        return;
      }

      if (isInitializingRef.current) {
        return;
      }

      setNeedsNetworkSwitch(false);
      isInitializingRef.current = true;

      try {
        setIsLoading(true);
        setError(null);

        const gatewayUrl = CONTRACT_ADDRESSES.GATEWAY;

        const providerObj = provider as { provider?: unknown };
        const ethereum: unknown = providerObj?.provider || (typeof window !== 'undefined' ? (window as { ethereum?: unknown }).ethereum : undefined);
        const hasEip1193 = !!ethereum && typeof ethereum === 'object' && ethereum !== null && 'request' in ethereum && typeof (ethereum as { request: unknown }).request === 'function';
        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

        const networkArg: unknown = hasEip1193 ? ethereum : rpcUrl;
        if (!networkArg) {
          setInstance(null);
          throw new Error('No Ethereum provider or RPC URL available');
        }

        // Use chainId from provider when wallet is ready; otherwise use env hex string
        let numericChainId: number;
        if (hasEip1193) {
          const net = await provider.getNetwork();
          numericChainId = Number(net.chainId);
        } else {
          const envHex = process.env.NEXT_PUBLIC_CHAIN_ID || '0xaa36a7';
          numericChainId = parseInt(envHex.startsWith('0x') ? envHex.slice(2) : envHex, 16);
        }

        const fheInstance = await initFhevm(
          networkArg,
          numericChainId,
          gatewayUrl
        );

        setInstance(fheInstance);
        lastChainIdRef.current = chainId;
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'NETWORK_ERROR' && 'event' in err && err.event === 'changed') {
          console.warn('Network changed during initialization, will retry automatically');
          setError(null);
        } else {
          console.error('Failed to create FHE instance:', err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          
          let friendlyMessage = 'Failed to create FHE instance';
          if (errorMessage.includes('Too Many Requests') || errorMessage.includes('-32005')) {
            friendlyMessage = 'RPC rate limit reached. Please configure your own RPC URL or wait a moment';
          } else if (errorMessage.includes('BAD_DATA')) {
            friendlyMessage = 'Failed to connect to blockchain. Please check your network connection';
          }
          
          setError(friendlyMessage);
        }
      } finally {
        setIsLoading(false);
        isInitializingRef.current = false;
      }
    };

    createFheInstance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkInitialized, isConnected, chainId, instance]);

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

