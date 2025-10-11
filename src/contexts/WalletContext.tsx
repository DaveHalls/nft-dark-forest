'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
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
  const hasAttemptedReconnect = useRef(false);
  const activeEip1193Ref = useRef<unknown>(null);

  const getActiveEip1193Provider = useCallback(() => {
    const fromRef = activeEip1193Ref.current as { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>; send?: (method: string, params?: unknown[]) => Promise<unknown> } | null;
    if (fromRef) return fromRef;
    const fromWrapped = (walletState.provider as unknown as { provider?: unknown })?.provider as { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>; send?: (method: string, params?: unknown[]) => Promise<unknown> } | undefined;
    if (fromWrapped) return fromWrapped;
    const winEth = typeof window !== 'undefined' ? (window as unknown as { ethereum?: { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>; send?: (method: string, params?: unknown[]) => Promise<unknown> } }).ethereum : undefined;
    return winEth ?? null;
  }, [walletState.provider]);

  const eipRequest = useCallback(async (method: string, params?: unknown[]) => {
    const eip = getActiveEip1193Provider();
    if (!eip) throw new Error('No active wallet provider');
    if (
      typeof eip === 'object' &&
      eip &&
      'request' in eip &&
      typeof (eip as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }).request === 'function'
    ) {
      return await (eip as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }).request({ method, params });
    }
    if (
      typeof eip === 'object' &&
      eip &&
      'send' in eip &&
      typeof (eip as { send: (method: string, params?: unknown[]) => Promise<unknown> }).send === 'function'
    ) {
      return await (eip as { send: (method: string, params?: unknown[]) => Promise<unknown> }).send(method, params ?? []);
    }
    throw new Error('Active wallet provider does not support request/send');
  }, [getActiveEip1193Provider]);

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
    
    hasAttemptedReconnect.current = true;
  }, []);

  const switchChain = useCallback(async () => {
    try {
      await eipRequest('wallet_switchEthereumChain', [
        { chainId: DEFAULT_CHAIN.chainId },
      ]);

      const eip = getActiveEip1193Provider();
      const chainId = (await eipRequest('eth_chainId')) as string;
      const newProvider = eip ? new BrowserProvider(eip as never) : walletState.provider;
      setWalletState(prev => ({ ...prev, chainId, provider: newProvider ?? null }));
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 4902) {
        await eipRequest('wallet_addEthereumChain', [
          {
            chainId: DEFAULT_CHAIN.chainId,
            chainName: DEFAULT_CHAIN.chainName,
            nativeCurrency: DEFAULT_CHAIN.nativeCurrency,
            rpcUrls: DEFAULT_CHAIN.rpcUrls,
            blockExplorerUrls: DEFAULT_CHAIN.blockExplorerUrls,
          },
        ]);

        const chainId = (await eipRequest('eth_chainId')) as string;
        const eip = getActiveEip1193Provider();
        const newProvider = eip ? new BrowserProvider(eip as never) : walletState.provider;
        setWalletState(prev => ({ ...prev, chainId, provider: newProvider ?? null }));
      } else {
        throw error;
      }
    }
  }, [eipRequest, getActiveEip1193Provider, walletState.provider]);

  const connectWallet = useCallback(async (providerDetail?: EIP6963ProviderDetail) => {
    try {
      let provider: BrowserProvider;
      
      if (providerDetail) {
        provider = new BrowserProvider(providerDetail.provider);
        activeEip1193Ref.current = providerDetail.provider;
      } else if (typeof window !== 'undefined' && window.ethereum) {
        provider = new BrowserProvider(window.ethereum);
        activeEip1193Ref.current = window.ethereum;
      } else {
        throw new Error('No wallet detected');
      }

      const accounts = await provider.send('eth_requestAccounts', []);
      const chainId = (await eipRequest('eth_chainId')) as string;

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
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('user rejected') && !errorMessage.includes('User denied') && !errorMessage.includes('ACTION_REJECTED')) {
        console.error('Failed to connect wallet:', error);
      }
      throw error;
    }
  }, [switchChain, eipRequest]);

  useEffect(() => {
    const eip = getActiveEip1193Provider() as { on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void } | null;
    if (!eip) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const accountsArray = Array.isArray(accounts) ? (accounts as string[]) : [];
      if (accountsArray.length === 0) {
        disconnectWallet();
      } else {
        setWalletState(prev => ({ ...prev, address: accountsArray[0] }));
      }
    };

    const handleChainChanged = async (newChainId: unknown) => {
      const newChainIdStr = String(newChainId);
      const eipInner = getActiveEip1193Provider();
      const newProvider = eipInner ? new BrowserProvider(eipInner as never) : walletState.provider;
      setWalletState(prev => ({ ...prev, chainId: newChainIdStr, provider: newProvider ?? null }));
    };

    const handleDisconnect = () => {
      disconnectWallet();
    };

    eip.on?.('accountsChanged', handleAccountsChanged as (...args: unknown[]) => void);
    eip.on?.('chainChanged', handleChainChanged as (...args: unknown[]) => void);
    eip.on?.('disconnect', handleDisconnect as (...args: unknown[]) => void);

    return () => {
      eip.removeListener?.('accountsChanged', handleAccountsChanged as (...args: unknown[]) => void);
      eip.removeListener?.('chainChanged', handleChainChanged as (...args: unknown[]) => void);
      eip.removeListener?.('disconnect', handleDisconnect as (...args: unknown[]) => void);
    };
  }, [disconnectWallet, getActiveEip1193Provider, walletState.provider]);

  useEffect(() => {
    const reconnect = async () => {
      if (hasAttemptedReconnect.current) return;
      
      const wasConnected = localStorage.getItem('wallet_connected');
      const savedRdns = localStorage.getItem('wallet_rdns');
      
      if (wasConnected && availableWallets.length > 0) {
        hasAttemptedReconnect.current = true;
        try {
          const wallet = savedRdns 
            ? availableWallets.find(w => w.info.rdns === savedRdns)
            : availableWallets[0];
          
          if (wallet) {
            await connectWallet(wallet);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes('user rejected') || errorMessage.includes('User denied') || errorMessage.includes('ACTION_REJECTED')) {
            localStorage.removeItem('wallet_connected');
            localStorage.removeItem('wallet_rdns');
          }
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

