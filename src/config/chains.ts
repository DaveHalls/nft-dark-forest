export const SUPPORTED_CHAINS = {
  SEPOLIA: {
    chainId: '0xaa36a7',
    chainName: 'Sepolia',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: ['https://rpc.sepolia.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
} as const;

export const DEFAULT_CHAIN = SUPPORTED_CHAINS.SEPOLIA;

