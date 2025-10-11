'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import { useWalletContext } from '@/contexts/WalletContext';
import { CONTRACT_ADDRESSES, DarkForestNFTABI } from '@/config';
import { useNotificationContext } from '@/contexts/NotificationContext';
import HeroCard from './HeroCard';
import { ipfsToHttp } from '@/config/ipfs';

const HERO_CLASSES = [
  {
    id: 0,
    name: 'Brave Warrior',
    description: 'Brave warrior with powerful melee combat abilities',
    imageCid: 'bafkreifkvbyytyqi7z66a7q2k5kzoxxc7osevdafmmbvm2mbfkiyao5nie'
  },
  {
    id: 1,
    name: 'Legendary Swordmaster',
    description: 'Legendary swordsman with exceptional swordsmanship',
    imageCid: 'bafkreicox4d3grjebxqv62vsq7bedpfbogx3qfmul5sxwfcp4ud6gqueui'
  },
  {
    id: 2,
    name: 'Shadow Assassin',
    description: 'Shadow assassin with agile movements and deadly strikes',
    imageCid: 'bafkreigi5srff2asnxwkhqbobc2vsbe45bassbaspqerkikofot4mmylue'
  },
  {
    id: 3,
    name: 'Elite Archer',
    description: 'Elite archer with long-range precision sniping',
    imageCid: 'bafkreidvir3s5ml6cldydcrow7yguyw762fghnv27qeecvxw67ireakbna'
  },
  {
    id: 4,
    name: 'Mystic Mage',
    description: 'Mystic mage controlling elemental magic',
    imageCid: 'bafkreiem43q74cdoy2kpn3hwopdgumis2l6znsmjv3jpmpxjpmchf3hhom'
  }
];

export default function MintSection() {
  const { provider, address, isConnected } = useWalletContext();
  const { showNotification } = useNotificationContext();
  const [isMinting, setIsMinting] = useState(false);
  const [mintedTokenId, setMintedTokenId] = useState<number | null>(null);
  const [mintedClassId, setMintedClassId] = useState<number | null>(null);

  const handleMint = async () => {
    if (!isConnected || !provider || !address) {
      showNotification('Please connect wallet first', 'error');
      return;
    }

    try {
      setIsMinting(true);
      
      const signer = await provider.getSigner();
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        DarkForestNFTABI,
        signer
      );

      // FHE random number generation and encryption require significant gas
      const tx = await nftContract.mint({
        gasLimit: 10000000, // 10M gas limit
      });
      showNotification('Minting transaction submitted, awaiting confirmation...', 'info');

      const receipt = await tx.wait();
      
      // Reset minting state immediately after transaction confirmation
      setIsMinting(false);
      
      // Get tokenId from event
      const mintEvent = receipt.logs.find((log: ethers.Log | ethers.EventLog) => {
        try {
          const parsed = nftContract.interface.parseLog(log);
          return parsed?.name === 'NFTMinted';
        } catch {
          return false;
        }
      });

      if (mintEvent) {
        const parsed = nftContract.interface.parseLog(mintEvent);
        const tokenId = Number(parsed?.args?.tokenId || 0);
        
        showNotification(`NFT minted successfully! Token ID: #${tokenId}`, 'success');
        
        // Asynchronously query class info (doesn't block button state)
        nftContract.getClassId(tokenId).then((classIdBigInt: bigint) => {
          const classId = Number(classIdBigInt);
          setMintedTokenId(tokenId);
          setMintedClassId(classId);
          const className = HERO_CLASSES[classId].name;
          showNotification(`You got ${className}!`, 'success');
        }).catch((err: Error) => {
          console.error('Failed to query class:', err);
        });
      } else {
        showNotification('NFT minted successfully!', 'success');
      }

    } catch (err: unknown) {
      console.error('Minting error (detailed):', err);
      console.error('Error type:', typeof err);
      console.error('Error object:', JSON.stringify(err, null, 2));
      
      // Check if user cancelled
      const errorCode = (err as { code?: string | number })?.code;
      if (errorCode === 'ACTION_REJECTED' || errorCode === 4001) {
        showNotification('You cancelled the transaction', 'info');
        return;
      }
      
      // Other errors
      let message = 'Minting failed';
      if (err instanceof Error) {
        console.error('Error details:', {
          name: err.name,
          message: err.message,
          stack: err.stack,
        });
        
        // Extract user-friendly error message
        if (err.message.includes('insufficient funds')) {
          message = 'Insufficient balance, please add ETH';
        } else if (err.message.includes('user rejected')) {
          message = 'You cancelled the transaction';
        } else if (err.message.includes('execution reverted')) {
          message = 'Contract execution failed, please check contract configuration';
        } else {
          // Display short error message
          const shortMsg = err.message.split('\n')[0].substring(0, 100);
          message = `Minting failed: ${shortMsg}`;
        }
      }
      
      showNotification(message, 'error');
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-gray-200 mb-4">
          Mint Your Hero
        </h2>
        <p className="text-gray-400 mb-6">
          Randomly obtain a hero with fully encrypted attributes that only you can view
        </p>
        
        <div className="relative">
          <button
            onClick={handleMint}
            disabled={!isConnected || isMinting}
            className={`
              px-8 py-3 bg-yellow-500/20 border border-yellow-500 text-yellow-400 rounded-lg
              font-medium transition-all
              ${!isConnected || isMinting 
                ? 'opacity-50 cursor-not-allowed' 
                : 'hover:bg-yellow-500/30 hover:border-yellow-400 hover:text-yellow-300'
              }
            `}
          >
            {isMinting ? 'Minting...' : 'Mint Hero'}
          </button>

          {!isConnected && (
            <p className="text-sm text-red-400 mt-2">
              Please connect wallet first
            </p>
          )}

          {mintedTokenId !== null && mintedClassId !== null && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-3 px-6 py-3 bg-green-900/80 border border-green-600 rounded-lg whitespace-nowrap animate-pulse z-50">
              <p className="text-green-300 font-medium">
                🎉 {HERO_CLASSES[mintedClassId].name} #{mintedTokenId}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {HERO_CLASSES.map((hero) => (
            <HeroCard
              key={hero.id}
              classId={hero.id}
              className={hero.name}
              imageUrl={ipfsToHttp(`ipfs://${hero.imageCid}`)}
              description={hero.description}
            />
          ))}
        </div>
      </div>

      <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-6">
        <h4 className="text-lg font-bold text-gray-300 mb-4">📜 Minting Instructions</h4>
        <ul className="space-y-2 text-gray-400 text-sm">
          <li>• Each mint randomly obtains a hero of one class</li>
          <li>• Hero attributes (Attack, Defense, HP, Speed, Luck) are fully encrypted</li>
          <li>• Initial attribute range: 0-100, randomly generated by smart contract</li>
          <li>• Only NFT holders can view and use attributes</li>
          <li>• After minting, you can immediately participate in battles and win token rewards</li>
        </ul>
      </div>
    </div>
  );
}

