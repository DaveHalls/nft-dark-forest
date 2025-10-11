export interface EIP6963ProviderDetail {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: unknown;
}

export interface WalletState {
  address: string | null;
  chainId: string | null;
  isConnected: boolean;
  provider: unknown;
}

