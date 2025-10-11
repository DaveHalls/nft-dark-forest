'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { BrowserProvider } from 'ethers';
import type { WalletState, EIP6963ProviderDetail } from '@/types/wallet';
import { DEFAULT_CHAIN } from '@/config/chains';

interface WalletContextType extends WalletState {
  availableWallets: EIP6963ProviderDetail[];
  connectWallet: (providerDetail?: EIP6963ProviderDetail) => Promise<string>;
  disconnectWallet: () => void;
  switchChain: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
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

    const handleAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
      if (!wallets.find(w => w.info.uuid === detail.info.uuid)) {
        wallets.push(detail);
        setAvailableWallets([...wallets]);
      }
    };

    window.addEventListener('eip6963:announceProvider', handleAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    return () => {
      window.removeEventListener('eip6963:announceProvider', handleAnnounce);
    };
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

      setWalletState({
        address: accounts[0],
        chainId,
        isConnected: true,
        provider,
      });

      if (chainId !== DEFAULT_CHAIN.chainId) {
        await switchChain();
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('wallet_connected', 'true');
        if (providerDetail) {
          localStorage.setItem('wallet_rdns', providerDetail.info.rdns);
        }
      }

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
    
    if (typeof window !== 'undefined') {
      localStorage.removeItem('wallet_connected');
      localStorage.removeItem('wallet_rdns');
    }
  }, []);

  const switchChain = useCallback(async () => {
    if (!walletState.provider) return;
    const providerWithSend = walletState.provider as { send: (method: string, params: unknown[]) => Promise<unknown> };

    try {
      await providerWithSend.send('wallet_switchEthereumChain', [
        { chainId: DEFAULT_CHAIN.chainId },
      ]);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 4902) {
        await providerWithSend.send('wallet_addEthereumChain', [
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

    const handleChainChanged = async (chainId: string) => {
      if (window.ethereum) {
        const newProvider = new BrowserProvider(window.ethereum);
        setWalletState(prev => ({ ...prev, chainId, provider: newProvider }));
      } else {
        setWalletState(prev => ({ ...prev, chainId }));
      }
      
      if (chainId !== DEFAULT_CHAIN.chainId) {
        switchChain().catch(console.error);
      }
    };

    const handleDisconnect = () => {
      disconnectWallet();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.ethereum.on('disconnect', handleDisconnect);

    return () => {
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('disconnect', handleDisconnect);
      }
    };
  }, [disconnectWallet, switchChain]);

  useEffect(() => {
    const reconnect = async () => {
      const wasConnected = localStorage.getItem('wallet_connected');
      const savedRdns = localStorage.getItem('wallet_rdns');
      
      if (wasConnected && availableWallets.length > 0) {
        try {
          const wallet = savedRdns 
            ? availableWallets.find(w => w.info.rdns === savedRdns)
            : availableWallets[0];
          
          if (wallet) {
            await connectWallet(wallet);
          }
        } catch (error) {
          console.error('Auto-reconnect failed:', error);
        }
      }
    };

    reconnect();
  }, [availableWallets, connectWallet]);

  return (
    <WalletContext.Provider
      value={{
        ...walletState,
        availableWallets,
        connectWallet,
        disconnectWallet,
        switchChain,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWalletContext() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within WalletProvider');
  }
  return context;
}

