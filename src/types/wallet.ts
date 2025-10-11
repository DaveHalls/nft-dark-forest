export interface EIP6963ProviderDetail {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: any;
}

export interface WalletState {
  address: string | null;
  chainId: string | null;
  isConnected: boolean;
  provider: any;
}

