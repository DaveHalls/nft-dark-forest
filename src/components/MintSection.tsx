'use client';

import { useEffect, useState, useRef } from 'react';
import { ethers } from 'ethers';
import { useWalletContext } from '@/contexts/WalletContext';
import { CONTRACT_ADDRESSES, DarkForestNFTABI } from '@/config';
import { useNotificationContext } from '@/contexts/NotificationContext';
import HeroCard from './HeroCard';
import { ipfsToHttp } from '@/config/ipfs';
import { readWithFallback, getReadOnlyProvider } from '@/lib/provider';

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
  const [totalMinted, setTotalMinted] = useState<number>(0);
  const [displayedCount, setDisplayedCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const retryCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const maxRetries = 3;
    
    const loadTotal = async () => {
      try {
        if (process.env.NODE_ENV !== 'production') console.debug('[MintSection] loadTotal start');
        const res: bigint = await readWithFallback((p) => 
          new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).totalSupply()
        );
        if (!cancelled) {
          setTotalMinted(Number(res));
          setIsLoading(false);
          retryCountRef.current = 0;
        }
        if (process.env.NODE_ENV !== 'production') console.log('[MintSection] loadTotal ok', { total: Number(res) });
      } catch (err) {
        // Retry on failure (RPC may be temporarily unavailable)
        if (!cancelled && retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          if (process.env.NODE_ENV !== 'production') console.error(`[MintSection] loadTotal failed attempt ${retryCountRef.current}/${maxRetries}`, err);
          setTimeout(() => {
            if (!cancelled) loadTotal();
          }, 2000 * retryCountRef.current); // Exponential backoff
        } else if (!cancelled) {
          if (process.env.NODE_ENV !== 'production') console.error('[MintSection] loadTotal failed after retries', err);
        }
      }
    };
    
    retryCountRef.current = 0;
    loadTotal();
    return () => { cancelled = true; };
  }, [provider]);

  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => {
        setDisplayedCount(prev => {
          const next = prev + Math.floor(Math.random() * 5) + 1;
          return next > 100 ? Math.floor(Math.random() * 50) : next;
        });
      }, 100);
      return () => clearInterval(interval);
    } else {
      const duration = 800;
      const steps = 30;
      const increment = (totalMinted - displayedCount) / steps;
      let currentStep = 0;

      const interval = setInterval(() => {
        currentStep++;
        if (currentStep >= steps) {
          setDisplayedCount(totalMinted);
          clearInterval(interval);
        } else {
          setDisplayedCount(prev => Math.round(prev + increment));
        }
      }, duration / steps);

      return () => clearInterval(interval);
    }
  }, [isLoading, totalMinted, displayedCount]);

  const handleMint = async () => {
    if (!isConnected || !provider || !address) {
      showNotification('Please connect wallet first', 'error');
      if (process.env.NODE_ENV !== 'production') console.log('[Mint] not connected or no provider/address', { isConnected, hasProvider: !!provider, address });
      return;
    }

    try {
      setIsMinting(true);
      if (process.env.NODE_ENV !== 'production') console.log('[Mint] start');
      // Unified tip: wallet popup guidance

      // Ensure wallet has granted access (some wallets require explicit request)
      try {
        if (process.env.NODE_ENV !== 'production') console.log('[Mint] request accounts');
        await provider.send('eth_requestAccounts', []);
        if (process.env.NODE_ENV !== 'production') console.log('[Mint] request accounts ok');
      } catch (reqErr) {
        if (process.env.NODE_ENV !== 'production') console.error('[Mint] request accounts error', reqErr);
        const code = (reqErr as { code?: unknown })?.code;
        const msg = reqErr instanceof Error ? reqErr.message : String(reqErr);
        if (code === 4001 || msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
          showNotification('You cancelled the request', 'info');
          return;
        }
        throw reqErr;
      }
      
      const signer = await provider.getSigner();
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        DarkForestNFTABI,
        signer
      );
      if (process.env.NODE_ENV !== 'production') console.log('[Mint] contract ready');

      if (process.env.NODE_ENV !== 'production') console.log('[Mint] sending via eth_sendTransaction ...');
      try { await provider.send('eth_requestAccounts', []); } catch {}
      const from = await signer.getAddress();
      const encodedData = nftContract.interface.encodeFunctionData('mint', []);
      showNotification('Please confirm in your wallet', 'info');
      let txHashStr = await (provider as unknown as { send: (method: string, params?: unknown[]) => Promise<string> }).send('eth_sendTransaction', [
        { from, to: CONTRACT_ADDRESSES.NFT_DARK_FOREST, data: encodedData, gas: '0x989680' },
      ]);
      let tx;
      try {
        const receipt = await provider.waitForTransaction(txHashStr as string);
        if (!receipt) throw new Error('Transaction pending without receipt');
        tx = { hash: txHashStr as string, wait: async () => receipt } as unknown as ethers.ContractTransactionReceipt;
      } catch {
        if (process.env.NODE_ENV !== 'production') console.warn('[Mint] eth_sendTransaction path failed, trying contract.mint fallback');
        showNotification('Please confirm in your wallet', 'info');
        tx = await nftContract.mint({ gasLimit: 10_000_000n });
      }
      txHashStr = tx?.hash || '';
      showNotification(`Transaction submitted: ${txHashStr.slice(0, 10)}...`, 'info');
      if (process.env.NODE_ENV !== 'production') console.log('[Mint] tx submitted', txHashStr);

      const stableProvider = getReadOnlyProvider();
      const receipt = await stableProvider.waitForTransaction(txHashStr, 1);
      
      if (!receipt) {
        if (process.env.NODE_ENV !== 'production') console.log('[Mint] tx wait returned null');
        showNotification('Transaction submitted but not confirmed yet', 'info');
        setIsMinting(false);
        return;
      }
      if (process.env.NODE_ENV !== 'production') console.log('[Mint] tx confirmed', receipt.hash);
      
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
        if (process.env.NODE_ENV !== 'production') console.log('[Mint] event parsed', { tokenId });
        
        showNotification(`NFT minted successfully! Token ID: #${tokenId}`, 'success');
        
        // Asynchronously query class info (doesn't block button state)
        nftContract.getClassId(tokenId).then((classIdBigInt: bigint) => {
          const classId = Number(classIdBigInt);
          setMintedTokenId(tokenId);
          setMintedClassId(classId);
          const className = HERO_CLASSES[classId].name;
          showNotification(`You got ${className}!`, 'success');
        }).catch((err: Error) => {
          if (process.env.NODE_ENV !== 'production') console.error('[Mint] getClassId error', err);
        });

        // optimistic UI: increase total by 1; true value will refresh on next page load
        setTotalMinted((prev) => prev + 1);
      } else {
        showNotification('NFT minted successfully!', 'success');
        setTotalMinted((prev) => prev + 1);
      }

    } catch (err: unknown) {
      if (process.env.NODE_ENV !== 'production') console.error('[Mint] error (detailed):', err);
      
      // Check if user cancelled
      const errorCode = (err as { code?: string | number })?.code;
      if (errorCode === 'ACTION_REJECTED' || errorCode === 4001) {
        showNotification('You cancelled the transaction', 'info');
        return;
      }
      
      // Other errors
      let message = 'Minting failed';
      if (err instanceof Error) {
        if (process.env.NODE_ENV !== 'production') console.error('[Mint] error details:', { name: err.name, message: err.message, stack: err.stack });
        
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
      if (process.env.NODE_ENV !== 'production') console.log('[Mint] end');
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

          <p className="mt-1 text-center text-gray-400">
            Currently there are{' '}
            <span className="text-red-400 text-xl font-semibold align-baseline transition-all duration-100">
              {displayedCount}
            </span>{' '}
            heroes roaming in the Dark Forest
          </p>

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

