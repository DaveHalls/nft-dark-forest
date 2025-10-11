'use client';

import Image from 'next/image';
import { useNFTMetadata } from '@/hooks/useNFTMetadata';
import { getMetadataUrl } from '@/config/ipfs';
import type { NFTData } from '@/types/nft';

interface NFTCardProps {
  nft: NFTData;
  onBattle?: (tokenId: number) => void;
  onViewDetails?: (tokenId: number) => void;
}

export default function NFTCard({ nft, onBattle, onViewDetails }: NFTCardProps) {
  const metadataUrl = getMetadataUrl(nft.tokenId);
  const { metadata, isLoading } = useNFTMetadata(metadataUrl);

  const isOnCooldown = nft.cooldownUntil > Date.now() / 1000;
  const cooldownRemaining = isOnCooldown
    ? Math.ceil((nft.cooldownUntil - Date.now() / 1000) / 3600)
    : 0;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden hover:border-blue-500 transition-all">
      <div className="relative aspect-square bg-gray-900">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : metadata?.image ? (
          <Image
            src={metadata.image}
            alt={metadata.name || `NFT #${nft.tokenId}`}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <span className="text-4xl">{nft.className.split(' ')[0]}</span>
          </div>
        )}
        
        {isOnCooldown && (
          <div className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded text-xs font-bold">
            Cooldown {cooldownRemaining}h
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div>
          <h3 className="text-lg font-bold text-white truncate">
            {metadata?.name || `NFT #${nft.tokenId}`}
          </h3>
          <p className="text-sm text-blue-400">{nft.className}</p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="text-center">
            <div className="text-green-400 font-bold">{nft.wins}</div>
            <div className="text-gray-500 text-xs">Wins</div>
          </div>
          <div className="text-center">
            <div className="text-red-400 font-bold">{nft.losses}</div>
            <div className="text-gray-500 text-xs">Losses</div>
          </div>
          <div className="text-center">
            <div className="text-blue-400 font-bold">
              {nft.wins + nft.losses > 0
                ? Math.round((nft.wins / (nft.wins + nft.losses)) * 100)
                : 0}%
            </div>
            <div className="text-gray-500 text-xs">Win Rate</div>
          </div>
        </div>

        <div className="flex gap-2">
          {onBattle && (
            <button
              onClick={() => onBattle(nft.tokenId)}
              disabled={isOnCooldown}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                isOnCooldown
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isOnCooldown ? 'On Cooldown' : 'Battle'}
            </button>
          )}
          {onViewDetails && (
            <button
              onClick={() => onViewDetails(nft.tokenId)}
              className="flex-1 py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
            >
              Details
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

