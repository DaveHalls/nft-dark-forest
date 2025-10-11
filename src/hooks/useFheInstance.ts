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

        const network = await provider.getNetwork();
        const numericChainId = Number(network.chainId);
        const gatewayUrl = CONTRACT_ADDRESSES.GATEWAY;

        const ethersProvider = provider.provider || window.ethereum;
        if (!ethersProvider) {
          throw new Error('No Ethereum provider available');
        }

        const fheInstance = await initFhevm(
          ethersProvider,
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
    } catch (err: any) {
      console.error('Failed to switch network:', err);
      setError(err.message || 'Failed to switch network');
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

