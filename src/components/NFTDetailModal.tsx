'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import Image from 'next/image';
import { useWalletContext } from '@/contexts/WalletContext';
import { useFheInstance } from '@/hooks/useFheInstance';
import { CONTRACT_ADDRESSES, DarkForestNFTABI } from '@/config';

interface NFTDetailModalProps {
  tokenId: number;
  classId: number;
  className: string;
  imageUrl: string;
  wins: number;
  losses: number;
  onClose: () => void;
}

interface DecryptedAttributes {
  attack: number;
  defense: number;
  hp: number;
  speed: number;
  luck: number;
}

interface FheInstance {
  generateKeypair: () => { publicKey: string; privateKey: string };
  createEIP712: (publicKey: string, contractAddresses: string[], startTimeStamp: string, durationDays: string) => { domain: Record<string, unknown>; types: { UserDecryptRequestVerification: Array<{ name: string; type: string }> }; message: Record<string, unknown> };
  userDecrypt: (handleContractPairs: Array<{ handle: unknown; contractAddress: string }>, privateKey: string, publicKey: string, signature: string, contractAddress: string[], userAddress: string, startTimeStamp: string, durationDays: string) => Promise<Array<bigint | string>>;
}

export default function NFTDetailModal({
  tokenId,
  classId,
  className,
  imageUrl,
  wins,
  losses,
  onClose,
}: NFTDetailModalProps) {
  const { provider } = useWalletContext();
  const { instance: fheInstance } = useFheInstance();
  const [attributes, setAttributes] = useState<DecryptedAttributes | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAttributes = async () => {
    if (!provider || !fheInstance) {
      console.log('Waiting for provider or fheInstance...', { provider: !!provider, fheInstance: !!fheInstance });
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        DarkForestNFTABI,
        signer
      );

      console.log('Starting to fetch encrypted attributes...', { tokenId, userAddress });

      const encryptedAttrs = await nftContract.getEncryptedAttributes(tokenId);
      
      console.log('Encrypted attributes fetched successfully:', encryptedAttrs);

      const keypair = (fheInstance as FheInstance).generateKeypair();
      console.log('Keypair generated successfully');

      
      const handleContractPairs = [
        { handle: encryptedAttrs[0], contractAddress: CONTRACT_ADDRESSES.NFT_DARK_FOREST },
        { handle: encryptedAttrs[1], contractAddress: CONTRACT_ADDRESSES.NFT_DARK_FOREST },
        { handle: encryptedAttrs[2], contractAddress: CONTRACT_ADDRESSES.NFT_DARK_FOREST },
        { handle: encryptedAttrs[3], contractAddress: CONTRACT_ADDRESSES.NFT_DARK_FOREST },
        { handle: encryptedAttrs[4], contractAddress: CONTRACT_ADDRESSES.NFT_DARK_FOREST },
      ];

      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [CONTRACT_ADDRESSES.NFT_DARK_FOREST];

      const eip712 = (fheInstance as FheInstance).createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays
      );
      console.log('EIP712 data created successfully');

      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );
      console.log('User signature successful');

      console.log('Starting user decryption...');
      const result = await (fheInstance as FheInstance).userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        userAddress,
        startTimeStamp,
        durationDays
      );

      console.log('User decryption result:', result);

      const attack = Number(result[encryptedAttrs[0]]);
      const defense = Number(result[encryptedAttrs[1]]);
      const hp = Number(result[encryptedAttrs[2]]);
      const speed = Number(result[encryptedAttrs[3]]);
      const luck = Number(result[encryptedAttrs[4]]);

      console.log('All attributes decrypted successfully:', { attack, defense, hp, speed, luck });

      setAttributes({
        attack,
        defense,
        hp,
        speed,
        luck,
      });
    } catch (err) {
      console.error('Failed to decrypt attributes (full error):', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      if (errorMsg.includes('user rejected') || errorMsg.includes('User denied') || errorMsg.includes('ACTION_REJECTED')) {
        setError('Cancelled viewing attributes');
      } else {
        setError(`Failed to load attributes: ${errorMsg}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecrypt = () => {
    loadAttributes();
  };

  const getAttributeColor = (value: number) => {
    if (value >= 80) return 'text-green-400';
    if (value >= 60) return 'text-blue-400';
    if (value >= 40) return 'text-yellow-400';
    if (value >= 20) return 'text-orange-400';
    return 'text-red-400';
  };

  const getAttributeBarColor = (value: number) => {
    if (value >= 80) return 'bg-green-500';
    if (value >= 60) return 'bg-blue-500';
    if (value >= 40) return 'bg-yellow-500';
    if (value >= 20) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-200">NFT Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          <div className="flex gap-6 mb-6">
            <div className="w-48 h-48 relative rounded-lg overflow-hidden flex-shrink-0 bg-gray-800">
              <Image
                src={imageUrl}
                alt={className}
                fill
                className="object-cover"
                crossOrigin="anonymous"
                unoptimized
              />
              <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-gray-300">
                Class #{classId}
              </div>
            </div>

            <div className="flex-1">
              <h3 className="text-2xl font-bold text-gray-200 mb-2">{className}</h3>
              <p className="text-gray-400 mb-4">Token ID: #{tokenId}</p>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Battle Record:</span>
                  <span className="text-gray-200">{wins} Wins / {losses} Losses</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Win Rate:</span>
                  <span className="text-gray-200">
                    {wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-lg font-bold text-gray-200">Encrypted Attributes</h4>
              {isLoading ? (
                <button
                  disabled
                  className="px-4 py-2 bg-gray-700 cursor-not-allowed text-white rounded-lg text-sm font-medium flex items-center gap-2"
                >
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-white"></div>
                  Decrypting...
                </button>
              ) : !attributes ? (
                <button
                  onClick={handleDecrypt}
                  disabled={!provider || !fheInstance}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Decrypt Attributes
                </button>
              ) : (
                <button
                  onClick={handleDecrypt}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Re-decrypt
                </button>
              )}
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-700 rounded p-4 text-red-400 text-sm mb-4">
                {error}
              </div>
            )}

            {!attributes && !isLoading && (
              <div className="bg-blue-900/20 border border-blue-700 rounded p-4 text-blue-300 text-sm mb-4">
                Click the [Decrypt Attributes] button above and sign with your wallet to view the NFT&apos;s encrypted attributes.
              </div>
            )}

            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">Attack</span>
                  {isLoading ? (
                    <span className="text-gray-500">Decrypting...</span>
                  ) : attributes ? (
                    <span className={`font-bold ${getAttributeColor(attributes.attack)}`}>
                      {attributes.attack}
                    </span>
                  ) : (
                    <span className="text-gray-500">---</span>
                  )}
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${attributes ? getAttributeBarColor(attributes.attack) : 'bg-gray-600'}`}
                    style={{ width: attributes ? `${attributes.attack}%` : '0%' }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">Defense</span>
                  {isLoading ? (
                    <span className="text-gray-500">Decrypting...</span>
                  ) : attributes ? (
                    <span className={`font-bold ${getAttributeColor(attributes.defense)}`}>
                      {attributes.defense}
                    </span>
                  ) : (
                    <span className="text-gray-500">---</span>
                  )}
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${attributes ? getAttributeBarColor(attributes.defense) : 'bg-gray-600'}`}
                    style={{ width: attributes ? `${attributes.defense}%` : '0%' }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">HP</span>
                  {isLoading ? (
                    <span className="text-gray-500">Decrypting...</span>
                  ) : attributes ? (
                    <span className={`font-bold ${getAttributeColor(attributes.hp)}`}>
                      {attributes.hp}
                    </span>
                  ) : (
                    <span className="text-gray-500">---</span>
                  )}
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${attributes ? getAttributeBarColor(attributes.hp) : 'bg-gray-600'}`}
                    style={{ width: attributes ? `${attributes.hp}%` : '0%' }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">Speed</span>
                  {isLoading ? (
                    <span className="text-gray-500">Decrypting...</span>
                  ) : attributes ? (
                    <span className={`font-bold ${getAttributeColor(attributes.speed)}`}>
                      {attributes.speed}
                    </span>
                  ) : (
                    <span className="text-gray-500">---</span>
                  )}
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${attributes ? getAttributeBarColor(attributes.speed) : 'bg-gray-600'}`}
                    style={{ width: attributes ? `${attributes.speed}%` : '0%' }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">Luck</span>
                  {isLoading ? (
                    <span className="text-gray-500">Decrypting...</span>
                  ) : attributes ? (
                    <span className={`font-bold ${getAttributeColor(attributes.luck)}`}>
                      {attributes.luck}
                    </span>
                  ) : (
                    <span className="text-gray-500">---</span>
                  )}
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${attributes ? getAttributeBarColor(attributes.luck) : 'bg-gray-600'}`}
                    style={{ width: attributes ? `${attributes.luck}%` : '0%' }}
                  ></div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-700">
                <div className="flex justify-between">
                  <span className="text-gray-400">Overall Score</span>
                  {isLoading ? (
                    <span className="text-gray-500">Decrypting...</span>
                  ) : attributes ? (
                    <span className="text-xl font-bold text-blue-400">
                      {Math.round((attributes.attack + attributes.defense + attributes.hp + attributes.speed + attributes.luck) / 5)}
                    </span>
                  ) : (
                    <span className="text-gray-500">---</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700 rounded text-xs text-blue-300">
            These attributes are encrypted using Zama FHE technology and can only be decrypted and viewed by the NFT holder.
          </div>
        </div>
      </div>
    </div>
  );
}
