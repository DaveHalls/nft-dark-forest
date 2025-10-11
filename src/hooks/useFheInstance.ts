'use client';

import { useState, useEffect } from 'react';
import { useWalletContext } from '@/contexts/WalletContext';
import { useFhe } from '@/contexts/FheContext';
import { initFhevm } from '@/fhevm/fhe-client';
import { CONTRACT_ADDRESSES } from '@/config/contracts';
import { DEFAULT_CHAIN } from '@/config/chains';

export function useFheInstance() {
  const { provider, isConnected, chainId, switchChain } = useWalletContext();
  const { isInitialized: sdkInitialized } = useFhe();
  const [instance, setInstance] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsNetworkSwitch, setNeedsNetworkSwitch] = useState(false);

  useEffect(() => {
    const createFheInstance = async () => {
      if (!sdkInitialized || !isConnected || !provider) {
        setInstance(null);
        return;
      }

      if (chainId !== DEFAULT_CHAIN.chainId) {
        setNeedsNetworkSwitch(true);
        setError(`Please switch to ${DEFAULT_CHAIN.chainName} network`);
        return;
      }

      setNeedsNetworkSwitch(false);

      try {
        setIsLoading(true);
        setError(null);

        const gatewayUrl = CONTRACT_ADDRESSES.GATEWAY;

        // Prefer EIP-1193 provider (wallet), fallback to RPC URL when wallet is not ready
        const ethereum: any = (provider as any)?.provider || (typeof window !== 'undefined' ? (window as any).ethereum : undefined);
        const hasEip1193 = !!ethereum && typeof ethereum.request === 'function';
        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

        const networkArg: any = hasEip1193 ? ethereum : rpcUrl;
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
      } catch (err: any) {
        if (err.code === 'NETWORK_ERROR' && err.event === 'changed') {
          console.warn('Network changed during initialization, will retry automatically');
          setError(null);
        } else {
          console.error('Failed to create FHE instance:', err);
          setError(err.message || 'Failed to create FHE instance');
        }
      } finally {
        setIsLoading(false);
      }
    };

    createFheInstance();
  }, [sdkInitialized, isConnected, provider, chainId]);

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

