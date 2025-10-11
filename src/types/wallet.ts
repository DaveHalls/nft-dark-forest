import type { Eip1193Provider, BrowserProvider } from 'ethers';

export interface EIP6963ProviderDetail {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: Eip1193Provider;
}

export interface WalletState {
  address: string | null;
  chainId: string | null;
  isConnected: boolean;
  provider: BrowserProvider | null;
}

