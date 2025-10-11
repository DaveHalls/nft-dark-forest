export interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes: NFTAttribute[];
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
}

export interface NFTData {
  tokenId: number;
  owner: string;
  classId: number;
  className: string;
  metadata?: NFTMetadata;
  imageUrl?: string;
  wins: number;
  losses: number;
  cooldownUntil: number;
  isOnCooldown: boolean;
}

export const NFT_CLASSES = [
  'Brave Warrior',
  'Legendary Swordmaster',
  'Shadow Assassin',
  'Elite Archer',
  'Mystic Mage',
] as const;

export type NFTClass = typeof NFT_CLASSES[number];
