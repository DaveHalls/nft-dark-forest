'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import Image from 'next/image';
import { useWalletContext } from '@/contexts/WalletContext';
import { CONTRACT_ADDRESSES, DarkForestNFTABI } from '@/config';
import { ipfsToHttp } from '@/config/ipfs';
import { makeKey, getJSON, setJSON, remove as removeCache } from '@/lib/cache';
import { requestAccountsOrThrow, sendTxWithPopup } from '@/lib/provider';

export interface BattleInfo {
  requestId: string;
  attackerTokenId: number;
  defenderTokenId: number;
  status: 'initiating' | 'waiting' | 'revealing' | 'completed';
  revealTime: number;
  result?: 'win' | 'loss';
  // Decryption event explanation fields
  reasonCode?: number; // 1/2/3/4
  faster?: number; // 0/1
  attackerCrit?: number; // 0/1
  defenderCrit?: number; // 0/1
  error?: string;
}

export interface NFTInfo {
  tokenId: number;
  classId: number;
  className: string;
  imageUrl: string;
  wins?: number;
  losses?: number;
}

interface BattleArenaProps {
  battleList: BattleInfo[];
  nftList: NFTInfo[];
  onBattleUpdate: (requestId: string, updates: Partial<BattleInfo>) => void;
  onBattleRemove?: (requestId: string) => void;
  onBattleComplete?: () => void;
  onClearCache?: () => void;
  isLoading?: boolean;
}

export default function BattleArena({ battleList, nftList, onBattleUpdate, onBattleRemove, onBattleComplete, onClearCache, isLoading }: BattleArenaProps) {
  const { provider, chainId, address } = useWalletContext();
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});
  const [bufferCountdowns, setBufferCountdowns] = useState<Record<string, number>>({});
  const [externalNFTs, setExternalNFTs] = useState<Record<number, NFTInfo>>({});
  const [activeTab, setActiveTab] = useState<'ongoing' | 'completed_win' | 'completed_loss'>('ongoing');
  const completedOnce = useRef<Set<string>>(new Set());
  const revealedOnce = useRef<Set<string>>(new Set());
  const scopedKey = useCallback((...parts: Array<string | number>) => makeKey(['battle', chainId || 'na', address || 'na', CONTRACT_ADDRESSES.NFT_DARK_FOREST, ...parts]), [chainId, address]);

  useEffect(() => {
    const seenCompleted = getJSON<string[]>(scopedKey('seenCompleted')) || [];
    const seenRevealed = getJSON<string[]>(scopedKey('seenRevealed')) || [];
    completedOnce.current = new Set(seenCompleted);
    revealedOnce.current = new Set(seenRevealed);
  }, [chainId, address, scopedKey]);

  const getNFTInfo = (tokenId: number): NFTInfo | undefined => {
    return nftList.find(nft => nft.tokenId === tokenId) || externalNFTs[tokenId];
  };

  useEffect(() => {
    const loadExternalNFTs = async () => {
      if (!provider) return;

      const externalTokenIds = battleList
        .map(b => b.defenderTokenId)
        .filter(id => id > 0 && !nftList.find(nft => nft.tokenId === id));

      if (externalTokenIds.length === 0) return;

      try {
        const metaKey = scopedKey('nftMeta');
        const cachedMeta = getJSON<Record<number, NFTInfo>>(metaKey) || {};
        const fromCache: Record<number, NFTInfo> = {};
        const missing: number[] = [];
        for (const tokenId of externalTokenIds) {
          const hit = cachedMeta[tokenId];
          if (hit) fromCache[tokenId] = hit; else missing.push(tokenId);
        }
        if (Object.keys(fromCache).length) {
          setExternalNFTs(prev => ({ ...prev, ...fromCache }));
        }
        if (missing.length === 0) return;
        const nftContract = new ethers.Contract(
          CONTRACT_ADDRESSES.NFT_DARK_FOREST,
          DarkForestNFTABI,
          provider as unknown as ethers.ContractRunner
        );

        const HERO_CLASSES = [
          { id: 0, name: 'Brave Warrior', imageCid: 'bafkreifkvbyytyqi7z66a7q2k5kzoxxc7osevdafmmbvm2mbfkiyao5nie' },
          { id: 1, name: 'Legendary Swordmaster', imageCid: 'bafkreicox4d3grjebxqv62vsq7bedpfbogx3qfmul5sxwfcp4ud6gqueui' },
          { id: 2, name: 'Shadow Assassin', imageCid: 'bafkreigi5srff2asnxwkhqbobc2vsbe45bassbaspqerkikofot4mmylue' },
          { id: 3, name: 'Elite Archer', imageCid: 'bafkreidvir3s5ml6cldydcrow7yguyw762fghnv27qeecvxw67ireakbna' },
          { id: 4, name: 'Mystic Mage', imageCid: 'bafkreiem43q74cdoy2kpn3hwopdgumis2l6znsmjv3jpmpxjpmchf3hhom' }
        ];

        const newExternalNFTs: Record<number, NFTInfo> = {};

        for (const tokenId of missing) {
          const classIdBigInt = await nftContract.getClassId(tokenId);
          const classId = Number(classIdBigInt);
          const heroClass = HERO_CLASSES[classId];

          let wins = 0;
          let losses = 0;
          try {
            const battleRecord = await nftContract.getBattleRecord(tokenId);
            wins = Number(battleRecord.wins ?? battleRecord[0] ?? 0);
            losses = Number(battleRecord.losses ?? battleRecord[1] ?? 0);
          } catch {}

          newExternalNFTs[tokenId] = {
            tokenId,
            classId,
            className: heroClass.name,
            imageUrl: ipfsToHttp(`ipfs://${heroClass.imageCid}`),
            wins,
            losses,
          };
        }

        setExternalNFTs(prev => ({ ...prev, ...newExternalNFTs }));
        const merged = { ...(cachedMeta || {}), ...newExternalNFTs };
        setJSON(metaKey, merged, 600);
      } catch (error) {
        console.error('Failed to load external NFT info:', error);
      }
    };

    loadExternalNFTs();
  }, [battleList, nftList, provider, scopedKey]);

  useEffect(() => {
    const waitingBattles = battleList.filter(b => b.status === 'waiting');
    if (waitingBattles.length === 0) {
      setCountdowns({});
      return;
    }

    let timeOffset = 0;
    let isInitialized = false;

    const initTimeOffset = async () => {
      if (!provider || isInitialized) return;
      try {
        const currentBlock = await (provider as unknown as { getBlock: (tag: string) => Promise<{ timestamp?: number } | null> }).getBlock('latest');
        const blockTime = currentBlock?.timestamp || Math.floor(Date.now() / 1000);
        const localTime = Math.floor(Date.now() / 1000);
        timeOffset = blockTime - localTime;
        isInitialized = true;
      } catch (error) {
        console.error('Failed to get block time, using local time:', error);
        isInitialized = true;
      }
    };

    const updateCountdowns = () => {
      const now = Math.floor(Date.now() / 1000) + timeOffset;
      const newCountdowns: Record<string, number> = {};
      const newBufferCountdowns: Record<string, number> = {};
      
      waitingBattles.forEach(battle => {
        const remaining = Math.max(0, battle.revealTime - now);
        const bufferRemaining = Math.max(0, battle.revealTime + 5 - now);
        newCountdowns[battle.requestId] = remaining;
        newBufferCountdowns[battle.requestId] = bufferRemaining;
      });
      
      setCountdowns(newCountdowns);
      setBufferCountdowns(newBufferCountdowns);
    };

    initTimeOffset();
    const interval = setInterval(updateCountdowns, 1000);

    return () => clearInterval(interval);
  }, [battleList, provider, scopedKey]);

  // Poll revealing battles to avoid relying solely on events
  useEffect(() => {
    if (!provider) return;
    const revealing = battleList.filter(b => b.status === 'revealing');
    if (revealing.length === 0) return;

    let stopped = false;
    const nftContract = new ethers.Contract(
      CONTRACT_ADDRESSES.NFT_DARK_FOREST,
      DarkForestNFTABI,
      provider as unknown as ethers.ContractRunner
    );

    const tick = async () => {
      for (const b of revealing) {
        try {
          const req = await nftContract.getBattleRequest(BigInt(b.requestId));
          const isPending = req.isPending as boolean;
          const isRevealed = req.isRevealed as boolean;
          
          if (!isPending) {
            const attackerWins = (req.attackerWins as boolean) === true;
            const result = attackerWins ? 'win' : 'loss';
            if (!completedOnce.current.has(b.requestId)) {
              completedOnce.current.add(b.requestId);
              try { setJSON(scopedKey('seenCompleted'), Array.from(completedOnce.current), 86400); } catch {}
              console.log(`Poll detected battle ${b.requestId} completed, result: ${result}`);
              onBattleUpdate(b.requestId, { status: 'completed', result, error: undefined });
              if (onBattleComplete) onBattleComplete();
            }
          } else if (isRevealed && b.status !== 'revealing' && !revealedOnce.current.has(b.requestId)) {
            revealedOnce.current.add(b.requestId);
            try { setJSON(scopedKey('seenRevealed'), Array.from(revealedOnce.current), 86400); } catch {}
            onBattleUpdate(b.requestId, { status: 'revealing' });
          }
        } catch (err) {
          console.error(`Failed to poll battle ${b.requestId} status:`, err);
        }
      }
    };

    const handle = setInterval(() => {
      if (!stopped) tick();
    }, 5000);

    // Execute immediately once
    tick();

    return () => {
      stopped = true;
      clearInterval(handle);
    };
  }, [battleList, provider, onBattleComplete, onBattleUpdate, scopedKey]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleReveal = async (battle: BattleInfo) => {
    if (!provider) return;

    try {
      // Request accounts first to ensure wallet is active (especially after long wait)
      try {
        await requestAccountsOrThrow(provider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
          onBattleUpdate(battle.requestId, { error: 'Reveal cancelled by user' });
          return;
        }
        throw err;
      }

      const signer = await (provider as unknown as { getSigner: () => Promise<ethers.Signer> }).getSigner();
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        DarkForestNFTABI,
        signer
      );

      // Double check if on-chain time meets requirements
      const battleRequest = await nftContract.getBattleRequest(BigInt(battle.requestId));
      const currentBlock = await (provider as unknown as { getBlock: (tag: string) => Promise<{ timestamp?: number } | null> }).getBlock('latest');
      const currentTime = currentBlock?.timestamp || Math.floor(Date.now() / 1000);
      const revealTime = Number(battleRequest.revealTime);
      
      if (currentTime < revealTime) {
        const remaining = revealTime - currentTime;
        throw new Error(`Need to wait ${remaining} more seconds to reveal battle result`);
      }

      if (battleRequest.isRevealed) {
        throw new Error('This battle has already been revealed');
      }

      if (!battleRequest.isPending) {
        throw new Error('This battle has already been completed');
      }

      const data = nftContract.interface.encodeFunctionData('revealBattle', [BigInt(battle.requestId)]);
      const receipt = await sendTxWithPopup({
        provider: provider as unknown as ethers.BrowserProvider & { send: (m: string, p?: unknown[]) => Promise<unknown> },
        signer,
        to: CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        data,
        gasHex: '0x2dc6c0',
        fallbackSend: async () => {
          const tx = await nftContract.revealBattle(BigInt(battle.requestId), { gasLimit: 3000000 });
          return { hash: tx.hash } as { hash: string };
        },
        notify: (m, t) => { try { (window as unknown as { __notify?: (msg: string, type: string) => void }).__notify?.(m, t); } catch {} },
        pendingTip: 'Transaction submitted but not confirmed yet',
      });
      if (!receipt) {
        onBattleUpdate(battle.requestId, { error: 'Transaction submitted but not confirmed yet' });
        return;
      }

      console.log('Reveal request submitted, waiting for Gateway processing...');

      onBattleUpdate(battle.requestId, { status: 'revealing', error: undefined });

      // Listen for BattleEnded event (using strict filter + once to prevent duplicates)
      const filter = nftContract.filters.BattleEnded(BigInt(battle.requestId));

      const handleBattleEnded = (
        requestId: bigint,
        winnerId: bigint,
        loserId: bigint,
        winnerOwner: string,
        reasonCode: bigint,
        faster: bigint,
        attackerCrit: bigint,
        defenderCrit: bigint
      ) => {
        const result = Number(winnerId) === battle.attackerTokenId ? 'win' : 'loss';
        console.log('Battle ended event received:', {
          requestId: requestId.toString(),
          winnerId: winnerId.toString(),
          loserId: loserId.toString(),
          winnerOwner,
          reasonCode: Number(reasonCode),
          faster: Number(faster),
          attackerCrit: Number(attackerCrit),
          defenderCrit: Number(defenderCrit),
          result
        });

        if (!completedOnce.current.has(battle.requestId)) {
          completedOnce.current.add(battle.requestId);
          try { setJSON(scopedKey('seenCompleted'), Array.from(completedOnce.current), 86400); } catch {}
          onBattleUpdate(battle.requestId, {
            status: 'completed',
            result,
            reasonCode: Number(reasonCode),
            faster: Number(faster),
            attackerCrit: Number(attackerCrit),
            defenderCrit: Number(defenderCrit),
          });
          if (onBattleComplete) onBattleComplete();
        }
      };

      // Add one-time event listener to avoid multiple triggers and memory leaks
      nftContract.once(filter, handleBattleEnded);
      revealedOnce.current.add(battle.requestId);
      try { setJSON(scopedKey('seenRevealed'), Array.from(revealedOnce.current), 86400); } catch {}

      // Set timeout (prevent indefinite waiting), fallback to manual polling after timeout
      setTimeout(() => {
        // If event not received after timeout, manually refresh and check
        console.log('⏰ Gateway callback timeout, please refresh page later to check result');
        if (onBattleComplete) {
          onBattleComplete();
        }
      }, 1800000); // 30 minutes timeout (testnet requires longer time)
    } catch (err) {
      console.error('Failed to reveal battle:', err);
      
      let errorMsg = 'Reveal failed, please try again later';
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Need to wait')) errorMsg = msg;
      else if (msg.includes('Reveal delay not met')) errorMsg = 'Countdown not finished, please wait';
      else if (msg.includes('user rejected')) errorMsg = 'User cancelled transaction';
      else if (msg.includes('already been completed')) errorMsg = 'This battle has already been completed';
      else if (msg.includes('already been revealed') || msg.includes('Already revealed') || msg.includes('Battle not pending')) errorMsg = 'This battle has already been revealed';

      // If on-chain marked as "revealed/completed", don't revert to waiting, try to pull confirmation
      if (msg.includes('already been revealed') || msg.includes('Already revealed') || msg.includes('Battle not pending')) {
        console.log('Detected battle already revealed, fetching latest status...');
        try {
          const read = new ethers.Contract(
            CONTRACT_ADDRESSES.NFT_DARK_FOREST,
            DarkForestNFTABI,
            provider as unknown as ethers.ContractRunner
          );
          const req = await read.getBattleRequest(BigInt(battle.requestId));
          const isPending = (req.isPending as boolean) === true;
          const isRevealed = (req.isRevealed as boolean) === true;
          const attackerWins = (req.attackerWins as boolean) === true;
          
          console.log('Battle status:', { isPending, isRevealed, attackerWins });
          
          if (!isPending) {
            const result = attackerWins ? 'win' : 'loss';
            console.log('Battle completed, result:', result);
            onBattleUpdate(battle.requestId, { status: 'completed', result, error: undefined });
            if (onBattleComplete) onBattleComplete();
            return;
          }
          // Still pending but revealed: maintain revealing, prompt to wait for callback
          console.log('Battle revealed but callback not completed yet, please wait...');
          onBattleUpdate(battle.requestId, { status: 'revealing', error: 'Reveal request submitted, waiting for Zama Gateway callback...' });
          return;
        } catch (readErr) {
          console.error('Failed to read battle status:', readErr);
          // On read failure, revert to waiting with error
          onBattleUpdate(battle.requestId, { status: 'waiting', error: 'Failed to fetch battle status' });
          return;
        }
      }

      onBattleUpdate(battle.requestId, { error: errorMsg });
    }
  };

  const renderBattleCard = (battle: BattleInfo) => {
    const countdown = countdowns[battle.requestId] || 0;
    const postBuffer = bufferCountdowns[battle.requestId] || 0;
    const attackerNFT = getNFTInfo(battle.attackerTokenId);
    const defenderNFT = battle.defenderTokenId > 0 ? getNFTInfo(battle.defenderTokenId) : null;

    return (
      <div key={battle.requestId || `${battle.attackerTokenId}-temp`} className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
        {/* Battle sides information */}
        <div className="flex items-start justify-between gap-3">
          {/* Attacker */}
          <div className="flex-1 flex flex-col items-center">
            {attackerNFT && (
              <>
                <div className="text-sm font-bold text-blue-400 mb-2">{attackerNFT.className}</div>
                <div className="w-full max-w-[160px] aspect-square rounded-lg overflow-hidden bg-gray-800 border border-blue-500/30 relative">
                  <Image
                    src={attackerNFT.imageUrl}
                    alt={attackerNFT.className}
                    width={160}
                    height={160}
                    className="object-cover w-full h-full"
                    crossOrigin="anonymous"
                    unoptimized
                  />
                  <div className="absolute top-1 right-1 bg-black/70 px-1 py-0.5 rounded text-[10px] text-gray-300">#{attackerNFT.tokenId}</div>
                  {attackerNFT.wins !== undefined && attackerNFT.losses !== undefined && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/80 px-2 py-1">
                      <div className="text-[10px] text-green-400 font-medium">
                        {attackerNFT.wins}W {attackerNFT.losses}L Win Rate: {attackerNFT.wins + attackerNFT.losses > 0 ? Math.round((attackerNFT.wins / (attackerNFT.wins + attackerNFT.losses)) * 100) : 0}%
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          
          {/* VS / Result display area */}
          <div className="flex flex-col items-center justify-start pt-12 min-w-[100px]">
            <div className="text-gray-400 font-bold text-lg px-2 mb-2">VS</div>
            
            {/* Initiating battle - compact display */}
            {battle.status === 'initiating' && (
              <div className="flex flex-col items-center mt-4">
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-3 border-gray-600 border-t-blue-500"></div>
              </div>
            )}
            
            {/* Countdown - moved here */}
            {battle.status === 'waiting' && (
              <div className="text-center mt-4">
                <div className="text-3xl font-bold text-yellow-400 mb-2">
                  {formatTime(countdown)}
                </div>
                {countdown <= 0 && postBuffer <= 0 ? (
                  <button
                    onClick={() => handleReveal(battle)}
                    className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
                  >
                    Reveal Result
                  </button>
                ) : countdown <= 0 && postBuffer > 0 ? (
                  <p className="text-xs text-yellow-400">Finalizing {postBuffer}s</p>
                ) : countdown <= 10 ? (
                  <p className="text-xs text-yellow-400">Revealing Soon</p>
                ) : null}
              </div>
            )}
            
            {/* Revealing - moved here */}
            {battle.status === 'revealing' && (
              <div className="flex flex-col items-center mt-4 gap-2">
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-3 border-gray-600 border-t-yellow-500"></div>
                <p className="text-yellow-400 text-xs font-semibold whitespace-nowrap">Waiting for Zama Gateway callback...</p>
                <button
                  onClick={async () => {
                    try {
                      // Request accounts first to ensure wallet is active (especially after long wait)
                      try { await requestAccountsOrThrow(provider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> }); } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) return;
                        throw err;
                      }
                      const signer = await (provider as unknown as { getSigner: () => Promise<ethers.Signer> })?.getSigner();
                      if (!signer) return;
                      const nftContract = new ethers.Contract(
                        CONTRACT_ADDRESSES.NFT_DARK_FOREST,
                        DarkForestNFTABI,
                        signer
                      );
                      const data = nftContract.interface.encodeFunctionData('retryReveal', [BigInt(battle.requestId)]);
                      await sendTxWithPopup({
                        provider: provider as unknown as ethers.BrowserProvider & { send: (m: string, p?: unknown[]) => Promise<unknown> },
                        signer,
                        to: CONTRACT_ADDRESSES.NFT_DARK_FOREST,
                        data,
                        fallbackSend: async () => {
                          const tx = await nftContract.retryReveal(BigInt(battle.requestId));
                          return { hash: tx.hash } as { hash: string };
                        },
                        notify: (m, t) => { try { (window as unknown as { __notify?: (msg: string, type: string) => void }).__notify?.(m, t); } catch {} },
                      });
                    } catch (err) {
                      console.error('Failed to retry reveal:', err);
                    }
                  }}
                  className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
                >
                  Retry Reveal
                </button>
              </div>
            )}
            
            {/* Battle result - moved here */}
            {battle.status === 'completed' && (
              <div className="text-center space-y-1 mt-4">
                {battle.result === 'win' ? (
                  <div>
                    <div className="text-5xl mb-2">🏆</div>
                    <p className="text-green-400 font-bold text-base">Victory!</p>
                    <p className="text-gray-400 text-xs mt-1">+1000 Tokens</p>
                  </div>
                ) : (
                  <div>
                    <div className="text-5xl mb-2">💔</div>
                    <p className="text-red-400 font-bold text-base">Defeat</p>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Defender */}
          <div className="flex-1 flex flex-col items-center">
            {defenderNFT ? (
              <>
                <div className="text-sm font-bold text-red-400 mb-2">{defenderNFT.className}</div>
                <div className="w-full max-w-[160px] aspect-square rounded-lg overflow-hidden bg-gray-800 border border-red-500/30 relative">
                  <Image
                    src={defenderNFT.imageUrl}
                    alt={defenderNFT.className}
                    width={160}
                    height={160}
                    className="object-cover w-full h-full"
                    crossOrigin="anonymous"
                    unoptimized
                  />
                  <div className="absolute top-1 right-1 bg-black/70 px-1 py-0.5 rounded text-[10px] text-gray-300">#{defenderNFT.tokenId}</div>
                  {defenderNFT.wins !== undefined && defenderNFT.losses !== undefined && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/80 px-2 py-1">
                      <div className="text-[10px] text-green-400 font-medium">
                        {defenderNFT.wins}W {defenderNFT.losses}L Win Rate: {defenderNFT.wins + defenderNFT.losses > 0 ? Math.round((defenderNFT.wins / (defenderNFT.wins + defenderNFT.losses)) * 100) : 0}%
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-xs text-gray-500 pt-20">Matching...</div>
            )}
          </div>
        </div>

        {battle.status === 'completed' && (
          <div className="text-center space-y-1 mt-3">
            {(battle.reasonCode !== undefined) && (
              <div className="text-xs text-gray-300 bg-gray-800/60 border border-gray-700 rounded p-2">
                <div className="flex justify-center gap-3">
                  <span className="px-2 py-0.5 rounded bg-gray-700/70">First Strike: {battle.faster ? 'Yes' : 'No'}</span>
                  <span className="px-2 py-0.5 rounded bg-gray-700/70">Attacker Crit: {battle.attackerCrit ? 'Yes' : 'No'}</span>
                  <span className="px-2 py-0.5 rounded bg-gray-700/70">Defender Crit: {battle.defenderCrit ? 'Yes' : 'No'}</span>
                </div>
                <div className="mt-1 text-gray-400">
                  {battle.reasonCode === 1 && 'Won by first strike and higher score'}
                  {battle.reasonCode === 2 && 'Won by first strike and tied score'}
                  {battle.reasonCode === 3 && 'Won despite second strike with higher score'}
                  {battle.reasonCode === 4 && 'Lost due to lower score'}
                </div>
              </div>
            )}

            {onBattleRemove && (activeTab === 'completed_win' || activeTab === 'completed_loss') && (
              <button
                onClick={() => onBattleRemove(battle.requestId)}
                className="mt-2 px-3 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        )}

        {battle.error && (
          <div className="mt-2 p-2 bg-red-900/20 border border-red-700 rounded text-red-400 text-xs">
            <p>{battle.error}</p>
            {battle.status === 'waiting' && (
              <button
                onClick={() => onBattleUpdate(battle.requestId, { error: undefined })}
                className="mt-1 text-xs text-gray-400 hover:text-gray-200 underline"
              >
                Close
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const ongoingBattles = battleList
    .filter(b => 
      b.status === 'initiating' || b.status === 'waiting' || b.status === 'revealing'
    )
    .sort((a, b) => Number(b.requestId || 0) - Number(a.requestId || 0)); // Newest on top
  
  const completedWin = battleList
    .filter(b => b.status === 'completed' && b.result === 'win')
    .sort((a, b) => Number(b.requestId || 0) - Number(a.requestId || 0));
  const completedLoss = battleList
    .filter(b => b.status === 'completed' && b.result === 'loss')
    .sort((a, b) => Number(b.requestId || 0) - Number(a.requestId || 0));

  const displayBattles = activeTab === 'ongoing' 
    ? ongoingBattles 
    : activeTab === 'completed_win' 
      ? completedWin 
      : completedLoss;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col h-[calc(100vh-8rem)] max-h-[800px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xl font-bold text-gray-200">Battle Info</h3>
        {onClearCache && (
          <button 
            onClick={() => {
              onClearCache?.();
              removeCache(scopedKey('nftMeta'));
              removeCache(scopedKey('seenCompleted'));
              removeCache(scopedKey('seenRevealed'));
            }}
            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 rounded transition-colors"
          >
            Clear Cache
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setActiveTab('ongoing')}
          className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors relative ${
            activeTab === 'ongoing'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          {isLoading && (
            <span className="absolute left-2 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </span>
          )}
          Ongoing {ongoingBattles.length > 0 && `(${ongoingBattles.length})`}
        </button>
        <button
          onClick={() => setActiveTab('completed_win')}
          className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors relative ${
            activeTab === 'completed_win'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          {isLoading && (
            <span className="absolute left-2 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </span>
          )}
          Victory {completedWin.length > 0 && `(${completedWin.length})`}
        </button>
        <button
          onClick={() => setActiveTab('completed_loss')}
          className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors relative ${
            activeTab === 'completed_loss'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          {isLoading && (
            <span className="absolute left-2 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </span>
          )}
          Defeat {completedLoss.length > 0 && `(${completedLoss.length})`}
        </button>
      </div>

      {/* Battle list - fixed height, scrollable */}
      <div className="flex-1 mb-3 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
        {displayBattles.length === 0 ? (
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 text-center">
            <div className="text-4xl mb-3">⚔</div>
            <p className="text-gray-400 text-sm">
              {activeTab === 'ongoing' ? 'No ongoing battles' : activeTab === 'completed_win' ? 'No victorious battles' : 'No defeated battles'}
            </p>
            {activeTab === 'ongoing' && (
            <p className="text-xs text-gray-500 mt-1">
              Select a hero from the right to initiate battle
            </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayBattles.map(battle => renderBattleCard(battle))}
          </div>
        )}
      </div>

      {/* Rules - fixed at bottom */}
      <div className="p-3 bg-gray-900/50 border border-gray-700 rounded text-xs text-gray-400 space-y-1">
        <p>• Select a hero to initiate battle</p>
        <p>• Random opponent matching</p>
        <p>• Victory rewards 1000 tokens</p>
        <p>• 5-hour cooldown after victory</p>
      </div>
    </div>
  );
}

