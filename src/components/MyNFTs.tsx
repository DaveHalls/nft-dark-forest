'use client';

import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import Image from 'next/image';
import { useWalletContext } from '@/contexts/WalletContext';
import { CONTRACT_ADDRESSES, DarkForestNFTABI } from '@/config';
import { useNotificationContext } from '@/contexts/NotificationContext';
import BattleArena, { BattleInfo } from './BattleArena';
import NFTDetailModal from './NFTDetailModal';
import { ipfsToHttp } from '@/config/ipfs';
import { isNetworkSwitchError } from '@/utils/errorHandler';
import { getReadOnlyProvider, getReadOnlyContract, readWithFallback } from '@/lib/provider';

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

interface NFTData {
  tokenId: number;
  classId: number;
  className: string;
  imageUrl: string;
  wins: number;
  losses: number;
  cooldownRemaining: number;
  isUpgrading?: boolean;
  upgradeRemaining?: number;
}

export default function MyNFTs() {
  const { provider, address, isConnected } = useWalletContext();
  const { showNotification } = useNotificationContext();
  const [nfts, setNfts] = useState<NFTData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNFT, setSelectedNFT] = useState<NFTData | null>(null);
  const [battleList, setBattleList] = useState<BattleInfo[]>([]);
  const [isBattleLoaded, setIsBattleLoaded] = useState(false);
  const [filter, setFilter] = useState<'all' | 'available' | 'unavailable'>('all');
  const lastRecoveredCountRef = useRef(0);
  const lastCheckTsRef = useRef(0);
  const lastLoadAddressRef = useRef<string | null>(null);
  const [isInfoExpanded, setIsInfoExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('battleInfoExpanded');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  useEffect(() => {
    if (isConnected && provider && address) {
      if (lastLoadAddressRef.current !== address) {
        lastLoadAddressRef.current = address;
        loadMyNFTs();
      }
    } else {
      setNfts([]);
      lastLoadAddressRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  // Subscribe to training events for timely status synchronization
  useEffect(() => {
    if (!provider || !isConnected || !address) return;
    const nftContract = new ethers.Contract(
      CONTRACT_ADDRESSES.NFT_DARK_FOREST,
      DarkForestNFTABI,
      provider
    );

    const onUpgradeStarted = (tokenId: bigint, attrIndex: number, completeAt: bigint) => {
      const complete = Number(completeAt);
      const now = Math.floor(Date.now() / 1000);
      setNfts(prev => prev.map(n => n.tokenId === Number(tokenId) ? {
        ...n,
        isUpgrading: true,
        upgradeRemaining: Math.max(0, complete - now),
      } : n));
    };

    const onUpgradeFinished = (tokenId: bigint) => {
      setNfts(prev => prev.map(n => n.tokenId === Number(tokenId) ? {
        ...n,
        isUpgrading: false,
        upgradeRemaining: 0,
      } : n));
    };

    nftContract.on('UpgradeStarted', onUpgradeStarted);
    nftContract.on('UpgradeFinished', onUpgradeFinished);

    return () => {
      nftContract.off('UpgradeStarted', onUpgradeStarted);
      nftContract.off('UpgradeFinished', onUpgradeFinished);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  // Local countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setNfts(prev => prev.map(n => n.isUpgrading ? {
        ...n,
        upgradeRemaining: Math.max(0, (n.upgradeRemaining || 0) - 1),
      } : n));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const loadMyNFTs = async () => {
    if (!address) return;

    try {
      setIsLoading(true);
      setIsBattleLoaded(false);
      
      // Use stable public RPC for read-only queries
      const nftContract = getReadOnlyContract(
        CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        DarkForestNFTABI
      );

      let myTokenIds: Set<number>;

      try {
        const tokenIds = await readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).tokensOfOwner(address));
        myTokenIds = new Set(tokenIds.map((id: bigint) => Number(id)));
      } catch {
        console.warn('Contract method tokensOfOwner not available, falling back to event query');
        
        const currentBlock = await readWithFallback((p) => p.getBlockNumber());
        const fromBlock = Math.max(0, currentBlock - 50000);

        const chunkSize = 1000;
        const transferToEvents: Array<ethers.Log | ethers.EventLog> = [];
        const transferFromEvents: Array<ethers.Log | ethers.EventLog> = [];
        let s1 = fromBlock;
        while (s1 <= currentBlock) {
          let end = Math.min(s1 + chunkSize, currentBlock);
          try {
            const [toChunk, fromChunk] = await Promise.all([
              readWithFallback((p) => {
                const c = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p);
                return c.queryFilter(c.filters.Transfer(null, address), s1, end);
              }),
              readWithFallback((p) => {
                const c = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p);
                return c.queryFilter(c.filters.Transfer(address, null), s1, end);
              }),
            ]);
            transferToEvents.push(...toChunk);
            transferFromEvents.push(...fromChunk);
            s1 = end + 1;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('10 block range')) {
              end = Math.min(s1 + 10, currentBlock);
              continue;
            }
            if (msg.includes('Block range is too large') || msg.includes('-32062') || msg.includes('-32600')) {
              end = Math.min(s1 + 10, currentBlock);
              continue;
            }
            throw err;
          }
        }

        myTokenIds = new Set<number>();
        
        for (const event of transferToEvents) {
          if ('args' in event) {
            const tokenId = Number(event.args[2]);
            if (tokenId) myTokenIds.add(tokenId);
          }
        }
        
        for (const event of transferFromEvents) {
          if ('args' in event) {
            const tokenId = Number(event.args[2]);
            myTokenIds.delete(tokenId);
          }
        }
      }

      // Batch load NFT data in parallel
      const now = Math.floor(Date.now() / 1000);
      const nftDataTasks = Array.from(myTokenIds).map((tokenId) => async () => {
        try {
          const [classIdBigInt, battleRecord, upgradeState] = await Promise.all([
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getClassId(tokenId)),
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getBattleRecord(tokenId)).catch(() => [0, 0, 0]),
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getUpgradeState(tokenId)).catch(() => ({ inProgress: false, completeAt: 0 })),
          ]);

          const classId = Number(classIdBigInt);
          const heroClass = HERO_CLASSES[classId];
          
          let wins, losses, cooldownUntil;
          if (Array.isArray(battleRecord)) {
            wins = Number(battleRecord[0] || 0);
            losses = Number(battleRecord[1] || 0);
            cooldownUntil = Number(battleRecord[2] || 0);
          } else {
            wins = Number(battleRecord.wins || 0);
            losses = Number(battleRecord.losses || 0);
            cooldownUntil = Number(battleRecord.cooldownUntil || 0);
          }
          
          const cooldownRemaining = Math.max(0, cooldownUntil - now);
          const inProgress = Boolean(upgradeState.inProgress ?? upgradeState[0]);
          const completeAt = Number(upgradeState.completeAt ?? upgradeState[1] ?? 0);
          const isUpgrading = inProgress;
          const upgradeRemaining = inProgress ? Math.max(0, completeAt - now) : 0;

          return {
            tokenId,
            classId,
            className: heroClass.name,
            imageUrl: ipfsToHttp(`ipfs://${heroClass.imageCid}`),
            wins,
            losses,
            cooldownRemaining,
            isUpgrading: isUpgrading as boolean,
            upgradeRemaining: upgradeRemaining as number,
          } as NFTData;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes('missing revert data') || msg.includes('invalid token') || msg.includes('nonexistent token')) {
            console.log(`NFT #${tokenId} does not exist, skipping`);
          } else {
            console.error(`Failed to load NFT #${tokenId}:`, error);
          }
          return null;
        }
      });

      // throttle concurrency to reduce RPC pressure
      const results: (NFTData | null)[] = new Array(nftDataTasks.length);
      const concurrency = 3;
      let nextIdx = 0;
      const runOne = async () => {
        const i = nextIdx++;
        if (i >= nftDataTasks.length) return;
        results[i] = await nftDataTasks[i]();
        await runOne();
      };
      await Promise.all(new Array(Math.min(concurrency, nftDataTasks.length)).fill(0).map(() => runOne()));
      const myNFTs = results.filter((nft): nft is NFTData => nft !== null && nft !== undefined) as NFTData[];

      // Sync training status from upgrade events with cache
      try {
        const myTokenIds = new Set(myNFTs.map(n => n.tokenId));
        const started: Record<number, { completeAt: number; blockNumber: number }> = {};
        const finished: Record<number, number> = {};

        const currentBlock = await readWithFallback((p) => p.getBlockNumber());
        const cacheKey = `upgradeHistory_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
        const lastBlockKey = `lastUpgradeBlock_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
        
        let eventFromBlock = Math.max(0, currentBlock - 50000);
        
        try {
          const cachedData = localStorage.getItem(cacheKey);
          const lastBlock = localStorage.getItem(lastBlockKey);
          if (cachedData && lastBlock) {
            const parsed = JSON.parse(cachedData);
            Object.assign(started, parsed.started || {});
            Object.assign(finished, parsed.finished || {});
            eventFromBlock = parseInt(lastBlock) + 1;
          }
        } catch {}

        const upStartEvents: Array<ethers.Log | ethers.EventLog> = [];
        const upFinishEvents: Array<ethers.Log | ethers.EventLog> = [];
        let s2 = eventFromBlock;
        while (s2 <= currentBlock) {
          const e2 = Math.min(s2 + 1000, currentBlock);
          try {
            const [startChunk, finishChunk] = await Promise.all([
              readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nftContract.filters.UpgradeStarted(), s2, e2)),
              readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nftContract.filters.UpgradeFinished(), s2, e2)),
            ]);
            upStartEvents.push(...startChunk);
            upFinishEvents.push(...finishChunk);
            s2 = e2 + 1;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('10 block range') || msg.includes('Block range is too large') || msg.includes('-32062') || msg.includes('-32600')) {
              // step down to very small chunk
              const e3 = Math.min(s2 + 10, currentBlock);
              const [startChunk2, finishChunk2] = await Promise.all([
                readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nftContract.filters.UpgradeStarted(), s2, e3)),
                readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nftContract.filters.UpgradeFinished(), s2, e3)),
              ]);
              upStartEvents.push(...startChunk2);
              upFinishEvents.push(...finishChunk2);
              s2 = e3 + 1;
              continue;
            }
            throw err;
          }
        }

        for (const ev of upStartEvents) {
          try {
            const parsed = nftContract.interface.parseLog({ topics: [...ev.topics], data: ev.data });
            if (!parsed?.args) continue;
            const tokenId = Number(parsed.args[0]);
            if (!myTokenIds.has(tokenId)) continue;
            const completeAt = Number(parsed.args[2]);
            if (!started[tokenId] || ev.blockNumber > (started[tokenId]?.blockNumber || 0)) {
              started[tokenId] = { completeAt, blockNumber: ev.blockNumber };
            }
          } catch {}
        }

        for (const ev of upFinishEvents) {
          try {
            const parsed = nftContract.interface.parseLog({ topics: [...ev.topics], data: ev.data });
            if (!parsed?.args) continue;
            const tokenId = Number(parsed.args[0]);
            if (!myTokenIds.has(tokenId)) continue;
            finished[tokenId] = Math.max(finished[tokenId] || 0, ev.blockNumber);
          } catch {}
        }

        const nowTs = Math.floor(Date.now() / 1000);
        myNFTs.forEach(n => {
          const st = started[n.tokenId];
          if (st) {
            const finBlock = finished[n.tokenId] || 0;
            if (st.blockNumber > finBlock) {
              n.isUpgrading = true;
              n.upgradeRemaining = Math.max(0, st.completeAt - nowTs);
            }
          }
        });
        
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ started, finished }));
          localStorage.setItem(lastBlockKey, currentBlock.toString());
        } catch {}
      } catch {}

      setNfts(myNFTs);
      
      if (myNFTs.length > 0) {
        // Check for ongoing battles
        await checkPendingBattle(nftContract, myNFTs);
      }
      setIsBattleLoaded(true);

    } catch (error) {
      if (isNetworkSwitchError(error)) {
        return;
      }
      console.error('Failed to load NFTs:', error);
      const message = error instanceof Error ? error.message : 'Loading failed';
      showNotification(message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const checkPendingBattle = async (nftContract: ethers.Contract, myNFTs: NFTData[]) => {
    try {
      if (!CONTRACT_ADDRESSES.NFT_DARK_FOREST) {
        console.warn('NFT contract address not configured');
        return;
      }

      const nowMs = Date.now();
      if (nowMs - lastCheckTsRef.current < 4000) return;
      lastCheckTsRef.current = nowMs;

      const battles: BattleInfo[] = [];
      const myTokenIds = myNFTs.map(nft => nft.tokenId);

  
      const battleCacheKey = `battleHistory_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
      const completedRequestIds = new Set<string>();
      try {
        const cachedData = localStorage.getItem(battleCacheKey);
        if (cachedData) {
          const parsed = JSON.parse(cachedData) as BattleInfo[];
          parsed.forEach(b => {
            if (b.status === 'completed' && b.requestId) {
              completedRequestIds.add(b.requestId);
            }
          });
        }
      } catch {}

      for (const nft of myNFTs) {
        try {
          const requestId = await readWithFallback((p) => 
            new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getPendingBattleByToken(nft.tokenId)
          );
          
          if (requestId && requestId > 0) {
            const reqIdStr = requestId.toString();
            
            if (completedRequestIds.has(reqIdStr)) {
              continue;
            }

            const battleRequest = await readWithFallback((p) => 
              new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getBattleRequest(requestId)
            );
          
          const isPending = battleRequest.isPending;
          const isRevealed = battleRequest.isRevealed;
          const revealTime = Number(battleRequest.revealTime);
          const attackerId = Number(battleRequest.attackerId);
          const defenderId = Number(battleRequest.defenderId);

          if (isPending) {
            let status: 'waiting' | 'revealing' = 'waiting';
            
            if (!isRevealed) {
              status = 'waiting';
            } else {
              status = 'revealing';
            }

            battles.push({
              requestId: reqIdStr,
              attackerTokenId: attackerId,
              defenderTokenId: defenderId,
              status,
              revealTime,
            });
          } else {
            // Battle completed on-chain but event not received yet
            const attackerWins = Boolean(battleRequest.attackerWins);
            const result = attackerWins ? 'win' : 'loss';
            
            // Try to fetch battle details from BattleEnded event
            let reasonCode, faster, attackerCrit, defenderCrit;
            try {
              const currentBlock = await readWithFallback((p) => p.getBlockNumber());
              const fromBlock = Math.max(0, currentBlock - 50000);
              const endedEvents = await readWithFallback((p) => 
                new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p)
                  .queryFilter(
                    new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).filters.BattleEnded(BigInt(reqIdStr)), 
                    fromBlock, 
                    'latest'
                  )
              );
              if (endedEvents.length > 0) {
                const ev = endedEvents[0];
                const tempContract = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, getReadOnlyProvider());
                const parsed = tempContract.interface.parseLog({ topics: [...ev.topics], data: ev.data });
                if (parsed?.args) {
                  const args = parsed.args as unknown as { [key: number]: bigint | number };
                  reasonCode = Number(args[4]);
                  faster = Number(args[5]);
                  attackerCrit = Number(args[6]);
                  defenderCrit = Number(args[7]);
                }
              }
            } catch (err) {
              console.warn(`Failed to fetch battle details for ${reqIdStr}:`, err);
            }
            
            battles.push({
              requestId: reqIdStr,
              attackerTokenId: attackerId,
              defenderTokenId: defenderId,
              status: 'completed',
              revealTime: 0,
              result,
              reasonCode,
              faster,
              attackerCrit,
              defenderCrit,
            });
            console.log(`Detected completed battle ${reqIdStr} from getPendingBattleByToken, result: ${result}`);
          }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (!errorMessage.includes('missing revert data') && !errorMessage.includes('CALL_EXCEPTION')) {
            console.warn(`Failed to check battle for NFT #${nft.tokenId}:`, err);
          }
        }
      }

      const battleCurrentBlock = await readWithFallback((p) => p.getBlockNumber());
      const battleLastBlockKey = `lastBattleBlock_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
      
      let battleFromBlock = Math.max(0, battleCurrentBlock - 50000);
      const cachedBattles: BattleInfo[] = [];
      
      try {
        const cachedData = localStorage.getItem(battleCacheKey);
        const lastBlock = localStorage.getItem(battleLastBlockKey);
        if (cachedData && lastBlock) {
          const parsed = JSON.parse(cachedData);
          cachedBattles.push(...(parsed || []));
          battleFromBlock = parseInt(lastBlock) + 1;
        }
      } catch {}
      
      const events: Array<ethers.Log | ethers.EventLog> = [];
      let s3 = battleFromBlock;
      while (s3 <= battleCurrentBlock) {
        const e3 = Math.min(s3 + 1000, battleCurrentBlock);
        try {
          const chunkEvs = await readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nftContract.filters.BattleEnded(), s3, e3));
          events.push(...chunkEvs);
          s3 = e3 + 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('10 block range') || msg.includes('Block range is too large') || msg.includes('-32062') || msg.includes('-32600')) {
            const e4 = Math.min(s3 + 10, battleCurrentBlock);
            const chunkEvs2 = await readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nftContract.filters.BattleEnded(), s3, e4));
            events.push(...chunkEvs2);
            s3 = e4 + 1;
            continue;
          }
          throw err;
        }
      }

      for (const ev of events) {
        let requestId: bigint, winner: bigint, loser: bigint, reasonCode: number, faster: number, attackerCrit: number, defenderCrit: number;
        try {
          const parsed = nftContract.interface.parseLog({ topics: [...ev.topics], data: ev.data });
          if (!parsed || !parsed.args) continue;
          const args = parsed.args as unknown as {
            [key: number]: bigint | number;
          };
          requestId = args[0] as bigint;
          winner = args[1] as bigint;
          loser = args[2] as bigint;
          reasonCode = Number(args[4]);
          faster = Number(args[5]);
          attackerCrit = Number(args[6]);
          defenderCrit = Number(args[7]);
        } catch {
          continue;
        }
        const reqIdNum = Number(requestId);
        const winnerId = Number(winner);
        const loserId = Number(loser);

        if (myTokenIds.includes(winnerId) || myTokenIds.includes(loserId)) {
          try {
            const req = await nftContract.getBattleRequest(reqIdNum);
            const attackerId = Number(req.attackerId ?? req[0]);
            const defenderId = Number(req.defenderId ?? req[1]);
            const attackerWins = Boolean(req.attackerWins ?? req[7]);

            battles.push({
              requestId: reqIdNum.toString(),
              attackerTokenId: attackerId,
              defenderTokenId: defenderId,
              status: 'completed',
              revealTime: 0,
              result: attackerWins ? 'win' : 'loss',
              reasonCode,
              faster,
              attackerCrit,
              defenderCrit,
            });
          } catch {
            // Fallback: Fill in basic info even when not reading request
            const attackerTokenId = winnerId; // Cannot distinguish attacker/defender, default winner as attacker (fallback only)
            const defenderTokenId = loserId;
            battles.push({
              requestId: reqIdNum.toString(),
              attackerTokenId,
              defenderTokenId,
              status: 'completed',
              revealTime: 0,
              result: 'win',
              reasonCode,
              faster,
              attackerCrit,
              defenderCrit,
            });
          }
        }
      }

  
      const rank = (s: BattleInfo['status']) => (s === 'completed' ? 3 : s === 'revealing' ? 2 : s === 'waiting' ? 1 : 0);

      const merged = [...battles, ...cachedBattles];
      const withReqId = merged.filter(b => b.requestId && b.requestId !== '');
      const withoutReqId = merged.filter(b => !b.requestId || b.requestId === '');


      const byReqId = new Map<string, BattleInfo>();
      for (const b of withReqId) {
        const key = b.requestId as string;
        const prev = byReqId.get(key);
        if (!prev) {
          byReqId.set(key, b);
        } else if (rank(b.status) > rank(prev.status)) {
          byReqId.set(key, { ...prev, ...b });
        } else if (rank(b.status) === rank(prev.status)) {
          byReqId.set(key, {
            ...prev,
            ...b,
            reasonCode: b.reasonCode ?? prev.reasonCode,
            faster: b.faster ?? prev.faster,
            attackerCrit: b.attackerCrit ?? prev.attackerCrit,
            defenderCrit: b.defenderCrit ?? prev.defenderCrit,
          });
        }
      }

      const attackerHasReal = new Set<number>();
      for (const v of byReqId.values()) attackerHasReal.add(v.attackerTokenId);

      const placeholders: BattleInfo[] = [];
      for (const b of withoutReqId) {
        if (!attackerHasReal.has(b.attackerTokenId)) {
          const existed = placeholders.find(p => p.attackerTokenId === b.attackerTokenId);
          if (!existed || rank(b.status) > rank(existed.status)) {
            if (existed) {
              const idx = placeholders.indexOf(existed);
              placeholders[idx] = b;
            } else {
              placeholders.push(b);
            }
          }
        }
      }

      const allBattles = [...Array.from(byReqId.values()), ...placeholders];
      
      for (const battle of allBattles) {
        if (battle.status === 'completed' && battle.reasonCode === undefined) {
          try {
            const currentBlock = await readWithFallback((p) => p.getBlockNumber());
            const fromBlock = Math.max(0, currentBlock - 50000);
            const endedEvents: Array<ethers.Log | ethers.EventLog> = [];
            let s4 = fromBlock;
            while (s4 <= currentBlock) {
              const e4 = Math.min(s4 + 1000, currentBlock);
              try {
                const chunkEvs = await readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nftContract.filters.BattleEnded(BigInt(battle.requestId)), s4, e4));
                endedEvents.push(...chunkEvs);
                s4 = e4 + 1;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('10 block range') || msg.includes('Block range is too large') || msg.includes('-32062') || msg.includes('-32600')) {
                  const e5 = Math.min(s4 + 10, currentBlock);
                  const chunkEvs2 = await readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nftContract.filters.BattleEnded(BigInt(battle.requestId)), s4, e5));
                  endedEvents.push(...chunkEvs2);
                  s4 = e5 + 1;
                  continue;
                }
                throw err;
              }
            }
            if (endedEvents.length > 0) {
              const ev = endedEvents[0];
              const parsed = nftContract.interface.parseLog({ topics: [...ev.topics], data: ev.data });
              if (parsed?.args) {
                const args = parsed.args as unknown as { [key: number]: bigint | number };
                battle.reasonCode = Number(args[4]);
                battle.faster = Number(args[5]);
                battle.attackerCrit = Number(args[6]);
                battle.defenderCrit = Number(args[7]);
              }
            }
          } catch {}
        }
      }
      
      try {
        localStorage.setItem(battleCacheKey, JSON.stringify(allBattles));
        localStorage.setItem(battleLastBlockKey, battleCurrentBlock.toString());
      } catch {}
      
      if (allBattles.length > 0) {
        setBattleList(allBattles);
        if (allBattles.length !== lastRecoveredCountRef.current) {
          lastRecoveredCountRef.current = allBattles.length;
          console.log(`Recovered ${allBattles.length} battles total (ongoing + completed)`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('missing revert data') || errorMessage.includes('CALL_EXCEPTION')) {
        console.warn('Battle contract function may not be available or contract not deployed correctly');
      } else {
        console.error('Failed to check battles:', error);
      }
    }
  };

  const isNFTInBattle = (tokenId: number): boolean => {
    return battleList.some(
      battle => 
        battle.attackerTokenId === tokenId && 
        (battle.status === 'initiating' || battle.status === 'waiting' || battle.status === 'revealing')
    );
  };

  const handleBattle = async (tokenId: number) => {
    if (!provider) return;

    try {
      // Training protection (use wallet provider for consistency)
      try {
        const nftContract = new ethers.Contract(
          CONTRACT_ADDRESSES.NFT_DARK_FOREST,
          DarkForestNFTABI,
          provider
        );
        const st = await nftContract.getUpgradeState(tokenId);
        const inProgress = Boolean(st.inProgress ?? st[0]);
        if (inProgress) {
          showNotification('This hero is training and cannot battle', 'error');
          return;
        }
      } catch {}

      const newBattle: BattleInfo = {
        requestId: '',
        attackerTokenId: tokenId,
        defenderTokenId: 0,
        status: 'initiating',
        revealTime: 0,
      };

      setBattleList(prev => {
        // avoid duplicate initiating if user double clicks
        const exists = prev.some(b => b.attackerTokenId === tokenId && b.status === 'initiating');
        if (exists) return prev;
        return [...prev, newBattle];
      });

      try { await (provider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> }).send('eth_requestAccounts', []); } catch {}
      try { await (provider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> }).send('eth_requestAccounts', []); } catch {}
      const signer = await provider.getSigner();
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        DarkForestNFTABI,
        signer
      );

      // FHE battle calculation requires significant gas
      const txPromise = nftContract.initiateBattle(tokenId, { gasLimit: 10000000 });
      const timer = setTimeout(() => {
        showNotification('Waiting for wallet confirmation...', 'info');
      }, 15000);
      const tx = await txPromise.finally(() => clearTimeout(timer));
      const receipt = await tx.wait();

      const battleInitiatedEvent = receipt.logs.find(
        (log: ethers.Log | ethers.EventLog) => {
          try {
            const parsed = nftContract.interface.parseLog({
              topics: [...log.topics],
              data: log.data
            });
            return parsed?.name === 'BattleInitiated';
          } catch {
            return false;
          }
        }
      );

      if (battleInitiatedEvent) {
        const parsed = nftContract.interface.parseLog({
          topics: [...battleInitiatedEvent.topics],
          data: battleInitiatedEvent.data
        });
        const requestId = parsed?.args[0].toString();
        const defenderId = Number(parsed?.args[2]);
        const revealTime = Number(parsed?.args[3]);

        setBattleList(prev => {
          // first remove any initiating placeholders for this attacker to prevent duplicates
          const filtered = prev.filter(b => !(b.attackerTokenId === tokenId && b.status === 'initiating'));
          // then remove any existing records with same requestId to dedupe
          const deduped = filtered.filter(b => b.requestId !== requestId);
          return [
            ...deduped,
            {
              requestId,
              attackerTokenId: tokenId,
              defenderTokenId: defenderId,
              status: 'waiting' as const,
              revealTime,
            }
          ];
        });

        showNotification(`Battle initiated! Opponent #${defenderId}`, 'success');
      }
    } catch (error) {
      console.error('Failed to initiate battle:', error);
      const message = error instanceof Error ? error.message : 'Failed to initiate battle';
      if (message.includes('user rejected') || message.includes('User denied') || message.includes('ACTION_REJECTED')) {
        showNotification('Battle cancelled', 'info');
      } else {
        showNotification(message, 'error');
      }
      setBattleList(prev => prev.filter(b => !(b.attackerTokenId === tokenId && b.status === 'initiating')));
    }
  };

  if (!isConnected) {
    return (
      <div className="max-w-6xl mx-auto text-center py-12">
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8">
          <p className="text-gray-400 text-lg mb-4">Please connect wallet to view your NFTs</p>
          <p className="text-gray-500 text-sm">After connecting wallet, all your heroes will be displayed here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-3">
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              const newState = !isInfoExpanded;
              setIsInfoExpanded(newState);
              localStorage.setItem('battleInfoExpanded', String(newState));
            }}
            className="w-full px-3 py-2 flex items-center justify-between hover:bg-blue-900/30 transition-colors"
          >
            <span className="text-gray-200 font-medium text-xs">Battle Instructions</span>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${isInfoExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isInfoExpanded && (
            <div className="px-4 pb-3 border-t border-blue-500/20">
              <p className="text-gray-300 text-sm mt-2">
                Battle results are computed encrypted on-chain by FHE contract, with asynchronous decryption callback via Zama Gateway.
              </p>
              <p className="text-blue-300 text-sm">
                <span className="font-semibold">Testnet Note:</span> Cooldown times are shortened and matching your own heroes is supported for better experience.
              </p>
              <p className="text-yellow-300 text-sm">
                <span className="font-semibold">Note:</span> Battle rewards, cooldown times, and battle records only apply to the initiator; matched defenders are not affected.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Battle info */}
        <div>
          <BattleArena 
            battleList={battleList}
            nftList={nfts.map(nft => ({
              tokenId: nft.tokenId,
              classId: nft.classId,
              className: nft.className,
              imageUrl: nft.imageUrl,
              wins: nft.wins,
              losses: nft.losses,
            }))}
            isLoading={isLoading}
            onBattleUpdate={(requestId, updates) => {
              setBattleList(prev => {
                const updated = prev.map(b => 
                  b.requestId === requestId ? { ...b, ...updates } : b
                );
                
                // Sync to localStorage cache immediately
                try {
                  const cacheKey = `battleHistory_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
                  localStorage.setItem(cacheKey, JSON.stringify(updated));
                } catch (err) {
                  console.warn('Failed to update battle cache:', err);
                }
                
                return updated;
              });
            }}
            onBattleRemove={(requestId) => {
              setBattleList(prev => {
                const updated = prev.filter(b => b.requestId !== requestId);
                
                // Sync to localStorage cache immediately
                try {
                  const cacheKey = `battleHistory_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
                  localStorage.setItem(cacheKey, JSON.stringify(updated));
                } catch (err) {
                  console.warn('Failed to update battle cache:', err);
                }
                
                return updated;
              });
            }}
            onBattleComplete={loadMyNFTs}
            onClearCache={() => {
              const cacheKey = `battleHistory_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
              const lastBlockKey = `lastBattleBlock_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
              localStorage.removeItem(cacheKey);
              localStorage.removeItem(lastBlockKey);
              loadMyNFTs();
              showNotification('Cache cleared, reloading', 'info');
            }}
          />
        </div>

        {/* Right: My NFT list */}
        <div>
          <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-lg font-bold text-gray-300">My Heroes</h4>
              <div className="flex items-center gap-2">
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-1">
                  <button
                    onClick={() => setFilter('all')}
                    className={`px-2 py-1 text-xs rounded ${filter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:text-white'}`}
                  >All</button>
                  <button
                    onClick={() => setFilter('available')}
                    className={`px-2 py-1 text-xs rounded ${filter === 'available' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:text-white'}`}
                  >Available</button>
                  <button
                    onClick={() => setFilter('unavailable')}
                    className={`px-2 py-1 text-xs rounded ${filter === 'unavailable' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:text-white'}`}
                  >Unavailable</button>
                </div>
                <button
                  onClick={loadMyNFTs}
                  disabled={isLoading}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded transition-colors"
                >
                  {isLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-2">
              {nfts
                .filter((nft) => {
                  const available = !nft.isUpgrading && nft.cooldownRemaining === 0 && !isNFTInBattle(nft.tokenId);
                  if (filter === 'available') return available;
                  if (filter === 'unavailable') return !available;
                  return true;
                })
                .map((nft) => (
                <div key={nft.tokenId} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden scale-90 origin-top transition-all hover:scale-95">
                  {/* NFT image area */}
                  <div className="aspect-square bg-gray-900 relative overflow-hidden">
                    <Image
                      src={nft.imageUrl}
                      alt={nft.className}
                      fill
                      className="object-cover"
                      crossOrigin="anonymous"
                      unoptimized
                    />
                    <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-gray-300">
                      #{nft.tokenId}
                    </div>
                  </div>
                  
                  {/* Info area */}
                  <div className="p-2 space-y-1">
                    <div className="text-center border-b border-gray-700 pb-1">
                      <h3 className="text-xs font-bold text-gray-200 truncate">{nft.className}</h3>
                    </div>
                    
                    <div className="flex justify-between items-center text-xs py-0.5">
                      <span className="text-gray-500">Record</span>
                      <span className="text-gray-300 font-medium">
                        {nft.wins}W/{nft.losses}L
                      </span>
                    </div>
                    
                    {nft.isUpgrading ? (
                      <div className="text-xs text-yellow-400 text-center py-0.5">
                        {Math.ceil(nft.upgradeRemaining || 0) > 0
                          ? <>Training {Math.ceil(nft.upgradeRemaining || 0)}s</>
                          : <>Training complete, go to Training page to finish</>}
                      </div>
                    ) : isNFTInBattle(nft.tokenId) ? (
                      <div className="text-xs text-orange-400 text-center py-0.5">
                        In Battle
                      </div>
                    ) : nft.cooldownRemaining > 0 ? (
                      <div className="text-xs text-yellow-400 text-center py-0.5">
                        Cooldown {Math.floor(nft.cooldownRemaining / 3600)}h {Math.floor((nft.cooldownRemaining % 3600) / 60)}m
                      </div>
                    ) : (
                      <div className="text-xs text-green-400 text-center py-0.5">
                        Available
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-1">
                      <button
                        onClick={() => setSelectedNFT(nft)}
                        className="py-1 rounded text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition-all"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleBattle(nft.tokenId)}
                        disabled={!isBattleLoaded || nft.cooldownRemaining > 0 || isNFTInBattle(nft.tokenId) || nft.isUpgrading}
                        className={`
                          py-1 rounded text-xs font-bold transition-all
                          ${!isBattleLoaded || nft.cooldownRemaining > 0 || isNFTInBattle(nft.tokenId) || nft.isUpgrading
                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            : 'bg-red-600 hover:bg-red-700 text-white'
                          }
                        `}
                      >
                        {!isBattleLoaded ? 'Loading...' : nft.isUpgrading ? 'Training' : isNFTInBattle(nft.tokenId) ? 'In Battle' : nft.cooldownRemaining > 0 ? 'Cooldown' : 'Battle'}
                      </button>
                    </div>

                  </div>
                </div>
              ))}
              {isLoading && nfts.length === 0 && (
                <div className="col-span-full text-center text-gray-400 py-8">
                  <div className="animate-pulse">Loading...</div>
                </div>
              )}
              {!isLoading && nfts.length === 0 && (
                <div className="col-span-full text-center text-gray-500 py-8">
                  <div className="text-4xl mb-2">🎭</div>
                  <p>No heroes</p>
                  <p className="text-xs mt-1">Go to Mint Hero page to forge your first hero!</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
            <h4 className="text-lg font-bold text-gray-300 mb-3">Statistics</h4>
            <div className="grid grid-cols-5 gap-2 text-center">
              <div>
                <div className="text-xl font-bold text-gray-200">{nfts.length}</div>
                <div className="text-xs text-gray-400">Heroes</div>
              </div>
              <div>
                <div className="text-xl font-bold text-green-400">
                  {nfts.reduce((sum, nft) => sum + nft.wins, 0)}
                </div>
                <div className="text-xs text-gray-400">Wins</div>
              </div>
              <div>
                <div className="text-xl font-bold text-red-400">
                  {nfts.reduce((sum, nft) => sum + nft.losses, 0)}
                </div>
                <div className="text-xs text-gray-400">Losses</div>
              </div>
              <div>
                <div className="text-xl font-bold text-orange-400">
                  {battleList.filter(b => b.status === 'initiating' || b.status === 'waiting' || b.status === 'revealing').length}
                </div>
                <div className="text-xs text-gray-400">In Battle</div>
              </div>
              <div>
                <div className="text-xl font-bold text-blue-400">
                  {nfts.filter(nft => nft.cooldownRemaining === 0 && !isNFTInBattle(nft.tokenId)).length}
                </div>
                <div className="text-xs text-gray-400">Available</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NFT detail modal */}
      {selectedNFT && (
        <NFTDetailModal
          tokenId={selectedNFT.tokenId}
          classId={selectedNFT.classId}
          className={selectedNFT.className}
          imageUrl={selectedNFT.imageUrl}
          wins={selectedNFT.wins}
          losses={selectedNFT.losses}
          onClose={() => setSelectedNFT(null)}
        />
      )}
    </div>
  );
}

