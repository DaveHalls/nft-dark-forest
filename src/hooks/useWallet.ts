'use client';

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider } from 'ethers';
import type { WalletState, EIP6963ProviderDetail } from '@/types/wallet';
import { DEFAULT_CHAIN } from '@/config/chains';

export function useWallet() {
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    chainId: null,
    isConnected: false,
    provider: null,
  });
  const [availableWallets, setAvailableWallets] = useState<EIP6963ProviderDetail[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const wallets: EIP6963ProviderDetail[] = [];

    window.addEventListener('eip6963:announceProvider', (event: Event) => {
      const customEvent = event as CustomEvent<EIP6963ProviderDetail>;
      wallets.push(customEvent.detail);
      setAvailableWallets([...wallets]);
    });

    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }, []);

  const connectWallet = useCallback(async (providerDetail?: EIP6963ProviderDetail) => {
    try {
      let provider;
      
      if (providerDetail) {
        provider = new BrowserProvider(providerDetail.provider);
      } else if (typeof window !== 'undefined' && window.ethereum) {
        provider = new BrowserProvider(window.ethereum);
      } else {
        throw new Error('No wallet detected');
      }

      const accounts = await provider.send('eth_requestAccounts', []);
      const network = await provider.getNetwork();
      
      const chainId = `0x${network.chainId.toString(16)}`;
      if (chainId !== DEFAULT_CHAIN.chainId) {
        await switchChain();
      }

      setWalletState({
        address: accounts[0],
        chainId,
        isConnected: true,
        provider,
      });

      return accounts[0];
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }, [switchChain]);

  const disconnectWallet = useCallback(() => {
    setWalletState({
      address: null,
      chainId: null,
      isConnected: false,
      provider: null,
    });
  }, []);

  const switchChain = useCallback(async () => {
    if (!walletState.provider) return;

    try {
      await walletState.provider.send('wallet_switchEthereumChain', [
        { chainId: DEFAULT_CHAIN.chainId },
      ]);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 4902) {
        await walletState.provider.send('wallet_addEthereumChain', [
          {
            chainId: DEFAULT_CHAIN.chainId,
            chainName: DEFAULT_CHAIN.chainName,
            nativeCurrency: DEFAULT_CHAIN.nativeCurrency,
            rpcUrls: DEFAULT_CHAIN.rpcUrls,
            blockExplorerUrls: DEFAULT_CHAIN.blockExplorerUrls,
          },
        ]);
      } else {
        throw error;
      }
    }
  }, [walletState.provider]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnectWallet();
      } else {
        setWalletState(prev => ({ ...prev, address: accounts[0] }));
      }
    };

    const handleChainChanged = (chainId: string) => {
      setWalletState(prev => ({ ...prev, chainId }));
      if (chainId !== DEFAULT_CHAIN.chainId) {
        switchChain();
      }
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [disconnectWallet, switchChain]);

  return {
    ...walletState,
    availableWallets,
    connectWallet,
    disconnectWallet,
    switchChain,
  };
}

