export const CONTRACT_ADDRESSES = {
  NFT_DARK_FOREST: process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS || '',
  FHE_TOKEN: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ADDRESS || '',
  GATEWAY: process.env.NEXT_PUBLIC_GATEWAY_ADDRESS || '',
  MARKET: process.env.NEXT_PUBLIC_MARKET_CONTRACT_ADDRESS || '',
} as const;

export const BATTLE_CONFIG = {
  COOLDOWN_HOURS: 5,
  WIN_REWARD: 1000,
  CRIT_MULTIPLIER: 1.5,
  CRIT_THRESHOLD: 50,
} as const;

export const NFT_ATTRIBUTES = {
  ATTACK: { min: 0, max: 100 },
  DEFENSE: { min: 0, max: 100 },
  HP: { min: 0, max: 100 },
  SPEED: { min: 0, max: 100 },
  LUCK: { min: 0, max: 100 },
} as const;

