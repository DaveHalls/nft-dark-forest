'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { ethers } from 'ethers';
import { DarkForestNFTABI, CONTRACT_ADDRESSES } from '@/config';
import { useWalletContext } from '@/contexts/WalletContext';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { ipfsToHttp } from '@/config/ipfs';
import NFTDetailModal from './NFTDetailModal';
import { isNetworkSwitchError } from '@/utils/errorHandler';
import { makeKey, getJSON, setJSON, remove as removeCache } from '@/lib/cache';
import { getReadOnlyContract, readWithFallback, requestAccountsOrThrow, sendTxWithPopup } from '@/lib/provider';

interface OwnedNFT {
  tokenId: number;
  classId: number;
  className: string;
  imageUrl: string;
  isUpgrading?: boolean;
  upgradeCompleteAt?: number | null;
  upgradeRemaining?: number;
  wins?: number;
  losses?: number;
}

interface TrainingRecord {
  tokenId: number;
  className: string;
  imageUrl: string;
  attrIndex: number;
  attrName: string;
  status: 'training' | 'success' | 'failure';
  startTime: number;
  completeTime?: number;
  remaining?: number;
}

const HERO_CLASSES = [
  { id: 0, name: 'Brave Warrior', imageCid: 'bafkreifkvbyytyqi7z66a7q2k5kzoxxc7osevdafmmbvm2mbfkiyao5nie' },
  { id: 1, name: 'Legendary Swordmaster', imageCid: 'bafkreicox4d3grjebxqv62vsq7bedpfbogx3qfmul5sxwfcp4ud6gqueui' },
  { id: 2, name: 'Shadow Assassin', imageCid: 'bafkreigi5srff2asnxwkhqbobc2vsbe45bassbaspqerkikofot4mmylue' },
  { id: 3, name: 'Elite Archer', imageCid: 'bafkreidvir3s5ml6cldydcrow7yguyw762fghnv27qeecvxw67ireakbna' },
  { id: 4, name: 'Mystic Mage', imageCid: 'bafkreiem43q74cdoy2kpn3hwopdgumis2l6znsmjv3jpmpxjpmchf3hhom' },
];

const ATTR_NAMES = ['Attack', 'Defense', 'HP', 'Speed', 'Luck'];

// Overlap scan to resist small chain reorgs
const REORG_BUFFER = 64;

export default function TrainingSection() {
  const { provider, address, isConnected, chainId } = useWalletContext();
  const { showNotification } = useNotificationContext();
  const [isLoading, setIsLoading] = useState(false);
  const [chainTimeOffset, setChainTimeOffset] = useState(0);
  const [owned, setOwned] = useState<OwnedNFT[]>([]);
  const [startingTokens, setStartingTokens] = useState<Set<number>>(new Set());
  const [finishingTokens, setFinishingTokens] = useState<Set<number>>(new Set());
  const [isLeftLoaded, setIsLeftLoaded] = useState(false);
  
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'training' | 'success' | 'failure'>('training');
  const [selectedNFT, setSelectedNFT] = useState<OwnedNFT | null>(null);
  const [isOperatorApproved, setIsOperatorApproved] = useState(false);
  const lastLoadAddressRef = useRef<string | null>(null);
  const lastLoadTimeRef = useRef<number>(0);
  const scopedKey = (...parts: Array<string | number>) => makeKey(['training', chainId || 'na', address || 'na', CONTRACT_ADDRESSES.NFT_DARK_FOREST, ...parts]);
  const [isInfoExpanded, setIsInfoExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trainingInfoExpanded');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  useEffect(() => {
    if (isConnected && provider && address) {
      if (lastLoadAddressRef.current !== address) {
        lastLoadAddressRef.current = address;
        loadOwned();
      }
    } else {
      setOwned([]);
      setIsOperatorApproved(false);
      lastLoadAddressRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  useEffect(() => {
    let cancelled = false;
    const initOffset = async () => {
      if (!provider) return;
      try {
        const latest = await provider.getBlock('latest');
        const blockTime = latest?.timestamp || Math.floor(Date.now() / 1000);
        const local = Math.floor(Date.now() / 1000);
        if (!cancelled) setChainTimeOffset(blockTime - local);
      } catch {}
    };
    initOffset();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const getContract = async () => {
    if (!provider) throw new Error('Provider not ready');
    const signer = await provider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, signer);
  };

  const loadOwned = async (force = false): Promise<OwnedNFT[] | undefined> => {
    if (!address) return;
    
    const now = Date.now();
    if (!force && now - lastLoadTimeRef.current < 3000) {
      return;
    }
    lastLoadTimeRef.current = now;
    
    try {
      setIsLoading(true);
      const ownedCacheKey = scopedKey('owned');
      const cachedOwned = getJSON<OwnedNFT[]>(ownedCacheKey);
      if (!force && cachedOwned && cachedOwned.length && owned.length === 0) {
        setOwned(cachedOwned);
      }
      // Use stable public RPC for read-only queries
      const nft = getReadOnlyContract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI);
      
      let myTokenIds: Set<number>;

      try {
        // Use contract function to query owned NFTs (more efficient, no block range limit)
        const tokenIds = await readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).tokensOfOwner(address));
        myTokenIds = new Set(tokenIds.map((id: bigint) => Number(id)));
      } catch {
        // Fallback to event query if contract method not available
        console.warn('Contract method tokensOfOwner not available, falling back to event query');
        
        const currentBlock = await readWithFallback((p) => p.getBlockNumber());
        const fromBlock = Math.max(0, currentBlock - 50000);

        const transferToFilter = nft.filters.Transfer(null, address);
        const transferFromFilter = nft.filters.Transfer(address, null);
        
        const chunkSize = 2000;
        const transferToEvents: Array<ethers.Log | ethers.EventLog> = [];
        const transferFromEvents: Array<ethers.Log | ethers.EventLog> = [];
        let start = fromBlock;
        while (start <= currentBlock) {
          const end = Math.min(start + chunkSize, currentBlock);
          const [toChunk, fromChunk] = await Promise.all([
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(transferToFilter, start, end)),
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(transferFromFilter, start, end)),
          ]);
          transferToEvents.push(...toChunk);
          transferFromEvents.push(...fromChunk);
          start = end + 1;
        }

        myTokenIds = new Set<number>();
        
        for (const event of transferToEvents) {
          if (!('args' in event)) continue;
          const ev = event as ethers.EventLog;
          const tokenId = Number((ev.args as unknown as Array<unknown>)[2] as unknown as bigint | number | string);
          if (tokenId) myTokenIds.add(tokenId);
        }
        
        for (const event of transferFromEvents) {
          if (!('args' in event)) continue;
          const ev = event as ethers.EventLog;
          const tokenId = Number((ev.args as unknown as Array<unknown>)[2] as unknown as bigint | number | string);
          myTokenIds.delete(tokenId);
        }
      }

      // Batch load NFT data in parallel
      const now = Math.floor(Date.now() / 1000);
      const nftDataPromises = Array.from(myTokenIds).map(async (id) => {
        try {
          const [classId, upgradeState, battleRecord] = await Promise.all([
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getClassId(id)),
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getUpgradeState(id)).catch(() => ({ inProgress: false, completeAt: 0 })),
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getBattleRecord(id)).catch(() => [0, 0])
          ]);

          const meta = HERO_CLASSES[Number(classId)];
          const isUpgrading = Boolean(upgradeState.inProgress ?? upgradeState[0]);
          const completeAt = Number(upgradeState.completeAt ?? upgradeState[1] ?? 0);
          const upgradeRemaining = isUpgrading && completeAt ? Math.max(0, completeAt - now) : 0;

          let wins = 0;
          let losses = 0;
          if (Array.isArray(battleRecord)) {
            wins = Number(battleRecord[0] ?? 0);
            losses = Number(battleRecord[1] ?? 0);
          } else {
            wins = Number(battleRecord.wins ?? 0);
            losses = Number(battleRecord.losses ?? 0);
          }

          return {
            tokenId: id,
            classId: Number(classId),
            className: meta.name,
            imageUrl: ipfsToHttp(`ipfs://${meta.imageCid}`),
            isUpgrading: isUpgrading as boolean,
            upgradeCompleteAt: completeAt || null,
            upgradeRemaining: upgradeRemaining as number,
            wins,
            losses,
          } as OwnedNFT;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes('missing revert data') || msg.includes('invalid token') || msg.includes('nonexistent token')) {
            console.log(`NFT #${id} does not exist, skipping`);
          } else {
            console.error(`Failed to load NFT #${id}:`, error);
          }
          return null;
        }
      });

      // throttle concurrency to reduce RPC pressure
      const concurrency = 3;
      const out: (OwnedNFT | null)[] = new Array(nftDataPromises.length);
      let nextIndex = 0;
      const runOne = async () => {
        const i = nextIndex++;
        if (i >= nftDataPromises.length) return;
        out[i] = await nftDataPromises[i];
        await runOne();
      };
      await Promise.all(new Array(Math.min(concurrency, nftDataPromises.length)).fill(0).map(() => runOne()));
      const list = out.filter((nft): nft is OwnedNFT => nft !== null && nft !== undefined) as OwnedNFT[];
      
      // Sync upgrade state from events
      try {
        const currentBlock = await readWithFallback((p) => p.getBlockNumber());
        const myIds = new Set(list.map(n => n.tokenId));
        const started: Record<number, { completeAt: number; blockNumber: number }> = {};
        const finished: Record<number, number> = {};

        const cacheKey = scopedKey('upgradeEvents');
        const lastBlockKey = scopedKey('upgradeLastBlock');
        
        let eventFromBlock = Math.max(0, currentBlock - 50000);
        
        try {
          const cachedEvents = getJSON<{ started: Record<number, { completeAt: number; blockNumber: number }>; finished: Record<number, number> }>(cacheKey);
          const lastBlock = getJSON<number>(lastBlockKey);
          if (cachedEvents && lastBlock !== null && lastBlock !== undefined) {
            Object.assign(started, cachedEvents.started || {});
            Object.assign(finished, cachedEvents.finished || {});
            eventFromBlock = Math.max(0, Number(lastBlock) + 1 - REORG_BUFFER);
          }
        } catch {}

        const upStartEvents: Array<ethers.Log | ethers.EventLog> = [];
        const upFinishEvents: Array<ethers.Log | ethers.EventLog> = [];
        const chunkSize2 = 2000;
        let s = eventFromBlock;
        while (s <= currentBlock) {
          const e = Math.min(s + chunkSize2, currentBlock);
          const [startChunk, finishChunk] = await Promise.all([
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nft.filters.UpgradeStarted(), s, e)),
            readWithFallback((p) => new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).queryFilter(nft.filters.UpgradeFinished(), s, e)),
          ]);
          upStartEvents.push(...startChunk);
          upFinishEvents.push(...finishChunk);
          s = e + 1;
        }

        for (const ev of upStartEvents) {
          try {
            const parsed = nft.interface.parseLog({ topics: [...ev.topics], data: ev.data });
            if (!parsed?.args) continue;
            const tokenId = Number(parsed.args[0]);
            if (!myIds.has(tokenId)) continue;
            const completeAt = Number(parsed.args[2]);
            if (!started[tokenId] || ev.blockNumber > (started[tokenId]?.blockNumber || 0)) {
              started[tokenId] = { completeAt, blockNumber: ev.blockNumber };
            }
          } catch {}
        }

        for (const ev of upFinishEvents) {
          try {
            const parsed = nft.interface.parseLog({ topics: [...ev.topics], data: ev.data });
            if (!parsed?.args) continue;
            const tokenId = Number(parsed.args[0]);
            if (!myIds.has(tokenId)) continue;
            finished[tokenId] = Math.max(finished[tokenId] || 0, ev.blockNumber);
          } catch {}
        }

        const nowTs = Math.floor(Date.now() / 1000);
        list.forEach(n => {
          const st = started[n.tokenId];
          if (st) {
            const finBlock = finished[n.tokenId] || 0;
            if (st.blockNumber > finBlock) {
              n.isUpgrading = true;
              n.upgradeCompleteAt = st.completeAt;
              n.upgradeRemaining = Math.max(0, st.completeAt - nowTs);
            }
          }
        });
        
        try {
          setJSON(cacheKey, { started, finished }, 86400);
          setJSON(lastBlockKey, currentBlock, 86400);
        } catch {}
      } catch {}

      setOwned(list);
      try { setJSON(ownedCacheKey, list, 300); } catch {}
      
      await loadTrainingHistory(list);
      
      return list;
    } catch (e) {
      if (isNetworkSwitchError(e)) {
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      showNotification(`Failed to load NFT: ${msg}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTrainingHistory = async (nftList: OwnedNFT[]) => {
    if (nftList.length === 0) {
      setTrainingRecords([]);
      setIsLeftLoaded(true);
      return;
    }
    
    try {
      // Use stable public RPC for read-only queries
      const nft = getReadOnlyContract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI);
      const myTokenIds = new Set(nftList.map(n => n.tokenId));
      
      interface TrainingEvent {
        tokenId: number;
        attrIndex: number;
        blockNumber: number;
        timestamp: number;
        completeAt?: number;
        success?: boolean;
      }
      
      const currentBlock = await readWithFallback((p) => p.getBlockNumber());
      const cacheKey = scopedKey('history');
      const lastBlockKey = scopedKey('historyLastBlock');
      
      let cachedStartedEvents: TrainingEvent[] = [];
      let cachedFinishedEvents: TrainingEvent[] = [];
      let fromBlock = Math.max(0, currentBlock - 50000);
      
      try {
        const cachedData = getJSON<{ started: TrainingEvent[]; finished: TrainingEvent[] }>(cacheKey);
        const lastBlock = getJSON<number>(lastBlockKey);
        if (cachedData) {
          cachedStartedEvents = cachedData.started || [];
          cachedFinishedEvents = cachedData.finished || [];
        }
        if (typeof lastBlock === 'number' && !Number.isNaN(lastBlock)) {
          fromBlock = Math.max(Number(lastBlock) + 1 - REORG_BUFFER, 0);
        }
      } catch {}
      
      let startedEvents: TrainingEvent[] = [...cachedStartedEvents];
      let finishedEvents: TrainingEvent[] = [...cachedFinishedEvents];
      
      const computeRecords = (started: TrainingEvent[], finished: TrainingEvent[]): TrainingRecord[] => {
        const records: TrainingRecord[] = [];
        const finishedByKey = new Map<string, TrainingEvent[]>();
        for (const f of finished) {
          const key = `${f.tokenId}-${f.attrIndex}`;
          const arr = finishedByKey.get(key) || [];
          arr.push(f);
          finishedByKey.set(key, arr);
        }
        for (const [, arr] of finishedByKey) {
          arr.sort((a, b) => a.blockNumber - b.blockNumber);
        }
        started.sort((a, b) => a.blockNumber - b.blockNumber);
        const usedFinished = new Set<string>();
        for (const s of started) {
          const nftInfo = nftList.find(n => n.tokenId === s.tokenId);
          if (!nftInfo) continue;
          const key = `${s.tokenId}-${s.attrIndex}`;
          const candidates = finishedByKey.get(key) || [];
          let matched: TrainingEvent | undefined;
          for (const c of candidates) {
            const ck = `${c.tokenId}-${c.attrIndex}-${c.blockNumber}`;
            if (usedFinished.has(ck)) continue;
            if (c.blockNumber >= s.blockNumber) {
              matched = c;
              usedFinished.add(ck);
              break;
            }
          }
          if (matched) {
            records.push({
              tokenId: s.tokenId,
              className: nftInfo.className,
              imageUrl: nftInfo.imageUrl,
              attrIndex: s.attrIndex,
              attrName: ATTR_NAMES[s.attrIndex],
              status: matched.success ? 'success' : 'failure',
              startTime: s.timestamp,
              completeTime: matched.timestamp,
              remaining: 0,
            });
          } else {
            const now = Math.floor(Date.now() / 1000);
            const remaining = Math.max(0, (s.completeAt || 0) - now);
            records.push({
              tokenId: s.tokenId,
              className: nftList.find(n => n.tokenId === s.tokenId)!.className,
              imageUrl: nftList.find(n => n.tokenId === s.tokenId)!.imageUrl,
              attrIndex: s.attrIndex,
              attrName: ATTR_NAMES[s.attrIndex],
              status: 'training',
              startTime: s.timestamp,
              remaining,
            });
          }
        }
        records.sort((a, b) => (b.completeTime || b.startTime) - (a.completeTime || a.startTime));
        return records;
      };

      const upStartEvents: Array<ethers.Log | ethers.EventLog> = [];
      const upFinishEvents: Array<ethers.Log | ethers.EventLog> = [];
      try {
        const chunkSize = 2000;
        let start = fromBlock;
        while (start <= currentBlock) {
          const end = Math.min(start + chunkSize, currentBlock);
          const [startsChunk, finishesChunk] = await Promise.all([
            readWithFallback((p) => {
              const c = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p);
              return c.queryFilter(c.filters.UpgradeStarted(), start, end);
            }),
            readWithFallback((p) => {
              const c = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p);
              return c.queryFilter(c.filters.UpgradeFinished(), start, end);
            }),
          ]);
          upStartEvents.push(...startsChunk);
          upFinishEvents.push(...finishesChunk);
          start = end + 1;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('rate limit') || errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
          const cached = getJSON<{ started: TrainingEvent[]; finished: TrainingEvent[] }>(cacheKey);
          if (cached) {
            const rec = computeRecords([...(cached.started || [])], [...(cached.finished || [])]);
            setTrainingRecords(rec);
          }
          setIsLeftLoaded(true);
          return;
        }
        throw err;
      }

      const blockCache = new Map<number, number>();
      const getBlockTimestamp = async (blockNumber: number) => {
        if (blockCache.has(blockNumber)) {
          return blockCache.get(blockNumber)!;
        }
        const block = await readWithFallback((p) => p.getBlock(blockNumber));
        const timestamp = block!.timestamp;
        blockCache.set(blockNumber, timestamp);
        return timestamp;
      };
      
      for (const ev of upStartEvents) {
        try {
          const parsed = nft.interface.parseLog({ topics: [...ev.topics], data: ev.data });
          if (!parsed?.args) continue;
          
          const tokenId = Number(parsed.args[0]);
          if (!myTokenIds.has(tokenId)) continue;
          
          const attrIndex = Number(parsed.args[1]);
          const completeAt = Number(parsed.args[2]);
          const timestamp = await getBlockTimestamp(ev.blockNumber);
          
          startedEvents.push({
            tokenId,
            attrIndex,
            blockNumber: ev.blockNumber,
            timestamp,
            completeAt,
          });
        } catch {}
      }
      
      for (const ev of upFinishEvents) {
        try {
          const parsed = nft.interface.parseLog({ topics: [...ev.topics], data: ev.data });
          if (!parsed?.args) continue;
          
          const tokenId = Number(parsed.args[0]);
          if (!myTokenIds.has(tokenId)) continue;
          
          const attrIndex = Number(parsed.args[1]);
          const success = Boolean(parsed.args[2]);
          const timestamp = await getBlockTimestamp(ev.blockNumber);
          
          finishedEvents.push({
            tokenId,
            attrIndex,
            blockNumber: ev.blockNumber,
            timestamp,
            success,
          });
        } catch {}
      }
      
      const startedMap = new Map<string, TrainingEvent>();
      for (const e of startedEvents) {
        const k = `${e.tokenId}-${e.attrIndex}-${e.blockNumber}`;
        startedMap.set(k, e);
      }
      startedEvents = Array.from(startedMap.values());

      const finishedMap = new Map<string, TrainingEvent>();
      for (const e of finishedEvents) {
        const k = `${e.tokenId}-${e.attrIndex}-${e.blockNumber}`;
        finishedMap.set(k, e);
      }
      finishedEvents = Array.from(finishedMap.values());

      const records = computeRecords(startedEvents, finishedEvents);
      setTrainingRecords(records);
      setIsLeftLoaded(true);
      
      try {
        setJSON(cacheKey, {
          started: startedEvents,
          finished: finishedEvents
        }, 86400);
        const maxBlock = Math.max(
          ...(startedEvents.length ? startedEvents.map(e => e.blockNumber) : [0]),
          ...(finishedEvents.length ? finishedEvents.map(e => e.blockNumber) : [0])
        );
        setJSON(lastBlockKey, Number(maxBlock || currentBlock), 86400);
      } catch {}
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (errorMessage.includes('rate limit') || errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
        console.warn('RPC rate limit exceeded when loading training history');
      } else {
        console.error('Failed to load training history:', e);
      }
    } finally {
      setIsLeftLoaded(true);
    }
  };

  useEffect(() => {
    if (!provider || !isConnected) return;
    const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, provider);

    const onStarted = async (tokenId: bigint, attrIndex: bigint, completeAt: bigint) => {
      const t = Number(tokenId);
      const attr = Number(attrIndex);
      const comp = Number(completeAt);
      const now = Math.floor(Date.now() / 1000);
      
      let nftInfo: OwnedNFT | undefined;
      
      setOwned(prev => {
        const updated = prev.map(n => n.tokenId === t ? {
          ...n,
          isUpgrading: true,
          upgradeCompleteAt: comp,
          upgradeRemaining: Math.max(0, comp - now),
        } : n);

        nftInfo = prev.find(n => n.tokenId === t);

        try {
          const ownedCacheKey = scopedKey('owned');
          setJSON(ownedCacheKey, updated, 300);
        } catch (err) {
          console.warn('Failed to update owned NFTs cache:', err);
        }

        return updated;
      });

      if (nftInfo) {
        setTrainingRecords(prev => {
          const exists = prev.find(r => r.tokenId === t && r.attrIndex === attr && r.status === 'training');
          if (exists) return prev;
          
          const newRecord: TrainingRecord = {
            tokenId: t,
            className: nftInfo!.className,
            imageUrl: nftInfo!.imageUrl,
            attrIndex: attr,
            attrName: ATTR_NAMES[attr],
            status: 'training',
            startTime: now,
            remaining: Math.max(0, comp - now),
          };
          return [newRecord, ...prev];
        });
      }
    };

    const onFinished = (tokenId: bigint, attrIndex: bigint, success: boolean) => {
      const t = Number(tokenId);
      const attr = Number(attrIndex);
      
      setOwned(prev => {
        const updated = prev.map(n => n.tokenId === t ? {
          ...n,
          isUpgrading: false,
          upgradeRemaining: 0,
          upgradeCompleteAt: null,
        } : n);

        try {
          const ownedCacheKey = scopedKey('owned');
          setJSON(ownedCacheKey, updated, 300);
        } catch (err) {
          console.warn('Failed to update owned NFTs cache:', err);
        }

        return updated;
      });

      setTrainingRecords(prev => {
        const newStatus: 'success' | 'failure' = success ? 'success' : 'failure';
        const updated = prev.map(r => 
          r.tokenId === t && r.attrIndex === attr && r.status === 'training' 
            ? { ...r, status: newStatus, completeTime: Math.floor(Date.now() / 1000), remaining: 0 }
            : r
        );
        
        const wasUpdated = updated.some((r, i) => r !== prev[i]);
        if (wasUpdated) {
          if (success) {
            showNotification(
              `Training successful! Check if ${ATTR_NAMES[attr]} attribute has improved`,
              'success'
            );
          } else {
            showNotification(
              `Training failed, ${ATTR_NAMES[attr]} not improved`,
              'info'
            );
          }
        }
        
        return updated;
      });
    };

    nft.on('UpgradeStarted', onStarted);
    nft.on('UpgradeFinished', onFinished);
    return () => {
      nft.off('UpgradeStarted', onStarted);
      nft.off('UpgradeFinished', onFinished);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  useEffect(() => {
    const timer = setInterval(() => {
      setOwned(prev => prev.map(n => n.isUpgrading ? {
        ...n,
        upgradeRemaining: Math.max(0, (n.upgradeRemaining || 0) - 1),
      } : n));
      
      setTrainingRecords(prev => prev.map(r => r.status === 'training' && r.remaining ? {
        ...r,
        remaining: Math.max(0, r.remaining - 1),
      } : r));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const loadUpgradeState = async (id: number) => {
    try {
      const st = await readWithFallback((p) => 
        new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getUpgradeState(id)
      );
      const inProgress = Boolean(st.inProgress ?? st[0]);
      if (!inProgress) {
        setOwned(prev => {
          const updated = prev.map(n => n.tokenId === id ? {
            ...n,
            isUpgrading: false,
            upgradeRemaining: 0,
            upgradeCompleteAt: null,
          } : n);

          try {
            const ownedCacheKey = scopedKey('owned');
            setJSON(ownedCacheKey, updated, 300);
          } catch (err) {
            console.warn('Failed to update owned NFTs cache:', err);
          }

          return updated;
        });
      }
    } catch {}
  };

  const start = async (tokenId: number) => {
    if (!isConnected || !address) {
      showNotification('Please connect wallet first', 'info');
      return;
    }
    try {
      setStartingTokens(prev => new Set(prev).add(tokenId));
      
      // Request accounts first to ensure wallet is active (especially after long wait)
      try {
        await requestAccountsOrThrow(provider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
          showNotification('Training cancelled', 'info');
          return;
        }
        throw err;
      }
      
      const nft = await getContract();

      try {
        const st = await nft.getUpgradeState(tokenId);
        const inProgress = Boolean(st.inProgress ?? st[0]);
        const completeAt = Number(st.completeAt ?? st[1] ?? 0);
        if (inProgress) {
          const remain = Math.max(0, completeAt - Math.floor(Date.now() / 1000));
          showNotification(`Training in progress, can be completed in ${Math.ceil(remain)} seconds`, 'info');
          return;
        }
      } catch {}

      const data = nft.interface.encodeFunctionData('startUpgrade', [BigInt(tokenId)]);
      if (!provider) throw new Error('Provider not ready');
      const signer = await provider.getSigner();
      const receipt = await sendTxWithPopup({
        provider: provider as unknown as ethers.BrowserProvider & { send: (m: string, p?: unknown[]) => Promise<unknown> },
        signer,
        to: CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        data,
        fallbackSend: async () => {
          const tx = await nft.startUpgrade(BigInt(tokenId));
          return { hash: tx.hash } as { hash: string };
        },
        notify: (m: string, t: 'info' | 'success' | 'error') => showNotification(m, t),
        pendingTip: 'Transaction submitted but not confirmed yet',
      });
      if (!receipt) return;
      showNotification('Training started! Can be completed in 1 minute', 'success');

      try {
        const st2 = await nft.getUpgradeState(tokenId);
        const inProgress2 = Boolean(st2.inProgress ?? st2[0]);
        if (inProgress2) {
          const comp2 = Number(st2.completeAt ?? st2[1] ?? 0);
          const attr2 = Number(st2.pendingAttr ?? st2[2] ?? 0);
          const now2 = Math.floor(Date.now() / 1000);
          const info = owned.find(n => n.tokenId === tokenId);
          if (info) {
            setTrainingRecords(prev => {
              const exists = prev.some(r => r.tokenId === tokenId && r.attrIndex === attr2 && r.status === 'training');
              if (exists) return prev;
              const newRecord: TrainingRecord = {
                tokenId,
                className: info.className,
                imageUrl: info.imageUrl,
                attrIndex: attr2,
                attrName: ATTR_NAMES[attr2],
                status: 'training',
                startTime: now2,
                remaining: Math.max(0, comp2 - now2),
              };
              return [newRecord, ...prev];
            });
          }
        }
      } catch {}
      await loadUpgradeState(tokenId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Not owner')) {
        showNotification('You are not the owner of this hero', 'error');
      } else if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Training cancelled', 'info');
      } else {
        showNotification(`Failed to start training: ${msg}`, 'error');
      }
    } finally {
      setStartingTokens(prev => {
        const newSet = new Set(prev);
        newSet.delete(tokenId);
        return newSet;
      });
    }
  };

  const finish = async (tokenId: number) => {
    if (!isConnected || !address) {
      showNotification('Please connect wallet first', 'info');
      return;
    }
    try {
      setFinishingTokens(prev => new Set(prev).add(tokenId));
      
      // Request accounts first to ensure wallet is active (especially after long wait)
      try { await requestAccountsOrThrow(provider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> }); } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
          showNotification('Training completion cancelled', 'info');
          return;
        }
        throw err;
      }
      
      const nftRead = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, provider);
      const st = await nftRead.getUpgradeState(tokenId);
      const completeAt = Number(st.completeAt ?? st[1]);
      if (!provider) throw new Error('Wallet not available');
      const currentBlock = await provider.getBlock('latest');
      const blockTimestamp = currentBlock!.timestamp;
      const bufferUntil = completeAt + 5;
      
      if (blockTimestamp < bufferUntil) {
        const remaining = bufferUntil - blockTimestamp;
        showNotification(`Training not ready yet, please wait ${remaining} seconds`, 'info');
        return;
      }
      
      const nft = await getContract();
      const data = nft.interface.encodeFunctionData('finishUpgrade', [BigInt(tokenId)]);
      if (!provider) throw new Error('Provider not ready');
      const signer = await provider.getSigner();
      const receipt = await sendTxWithPopup({
        provider: provider as unknown as ethers.BrowserProvider & { send: (m: string, p?: unknown[]) => Promise<unknown> },
        signer,
        to: CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        data,
        fallbackSend: async () => {
          const tx = await nft.finishUpgrade(BigInt(tokenId));
          return { hash: tx.hash } as { hash: string };
        },
        notify: (m: string, t: 'info' | 'success' | 'error') => showNotification(m, t),
      });
      if (!receipt) return;
      await loadUpgradeState(tokenId);
      const updatedList = await loadOwned(true);
      if (updatedList) {
        await loadTrainingHistory(updatedList);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Training completion cancelled', 'info');
      } else if (msg.includes('Not ready')) {
        showNotification('Training not yet complete, please wait a few more seconds and try again', 'info');
      } else if (msg.includes('No upgrade') || msg.includes('not in progress')) {
        showNotification('This hero is not currently training', 'info');
      } else if (msg.includes('Not owner')) {
        showNotification('You are not the owner of this hero', 'error');
      } else {
        showNotification('Failed to complete training, please try again later', 'error');
      }
    } finally {
      setFinishingTokens(prev => {
        const newSet = new Set(prev);
        newSet.delete(tokenId);
        return newSet;
      });
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const removeRecord = (tokenId: number, attrIndex: number) => {
    setTrainingRecords(prev => prev.filter(r => !(r.tokenId === tokenId && r.attrIndex === attrIndex)));
  };

  const renderTrainingCard = (record: TrainingRecord) => {
    const owner = owned.find(n => n.tokenId === record.tokenId);
    const completeAt = owner?.upgradeCompleteAt || 0;
    const nowChain = Math.floor(Date.now() / 1000) + chainTimeOffset;
    const trainingRemaining = completeAt ? Math.max(0, completeAt - nowChain) : Math.max(0, (record.remaining || 0));
    const postBufferRemaining = completeAt ? Math.max(0, completeAt + 5 - nowChain) : 0;
    const canFinish = record.status === 'training' && trainingRemaining <= 0 && postBufferRemaining <= 0;
    const isThisFinishing = finishingTokens.has(record.tokenId);
    
    return (
      <div key={`${record.tokenId}-${record.attrIndex}-${record.startTime}`} className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-800 flex-shrink-0">
            <Image src={record.imageUrl} alt={record.className} width={48} height={48} className="object-cover" crossOrigin="anonymous" unoptimized />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-200 truncate">{record.className}</div>
            <div className="text-xs text-gray-400">#{record.tokenId} · Training {record.attrName}</div>
          </div>
        </div>

        {record.status === 'training' && (
          <div className="text-center space-y-2">
            <p className="text-yellow-400 font-bold text-sm">⏱️ Training {formatTime(trainingRemaining)}</p>
            {trainingRemaining <= 0 && postBufferRemaining > 0 && (
              <p className="text-xs text-yellow-400">Finalizing {postBufferRemaining}s</p>
            )}
            {canFinish ? (
              <button 
                onClick={() => finish(record.tokenId)}
                disabled={isThisFinishing}
                className="w-full py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded text-xs font-medium transition-colors"
              >
                {isThisFinishing ? 'Submitting...' : 'Complete Training'}
              </button>
            ) : null}
          </div>
        )}

        {record.status === 'success' && (
          <div className="text-center space-y-2">
            <p className="text-green-400 font-bold text-sm">✅ Training successful! {record.attrName} +1 Check attributes</p>
            <button onClick={() => removeRecord(record.tokenId, record.attrIndex)} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-700 hover:bg-gray-600 rounded transition-colors">Remove</button>
          </div>
        )}

        {record.status === 'failure' && (
          <div className="text-center space-y-2">
            <p className="text-red-400 font-bold text-sm">❌ Training failed {record.attrName} not improved</p>
            <button onClick={() => removeRecord(record.tokenId, record.attrIndex)} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-700 hover:bg-gray-600 rounded transition-colors">Remove</button>
          </div>
        )}
      </div>
    );
  };

  const trainingList = trainingRecords.filter(r => r.status === 'training');
  const successList = trainingRecords.filter(r => r.status === 'success');
  const failureList = trainingRecords.filter(r => r.status === 'failure');
  const displayRecords = activeTab === 'training' ? trainingList : activeTab === 'success' ? successList : failureList;

  if (!isConnected) {
    return (
      <div className="max-w-6xl mx-auto text-center py-12">
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8">
          <p className="text-gray-400 text-lg mb-2">Please connect wallet first</p>
          <p className="text-gray-500 text-sm">Your heroes will be displayed after connection for training selection</p>
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
              localStorage.setItem('trainingInfoExpanded', String(newState));
            }}
            className="w-full px-3 py-2 flex items-center justify-between hover:bg-blue-900/30 transition-colors"
          >
            <span className="text-gray-200 font-medium text-xs">Training Instructions</span>
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
                Randomly select an attribute to train, can be completed in 1 minute.<span className="text-yellow-400"> Only gas required, 50% chance +1</span> (can exceed 100). Cannot battle during training.
              </p>
              <p className="text-blue-300 text-sm">
                <span className="font-semibold">Testnet Note:</span> Training time significantly reduced to 1 minute for better experience.
              </p>
            </div>
          )}
        </div>
        
        {isConnected && isOperatorApproved && (
          <div className="bg-green-900/20 border border-green-600/30 rounded-lg p-2 flex items-center gap-2">
            <span className="text-green-400">✓</span>
            <span className="text-green-200 text-sm">Authorized, can start training</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col h-[calc(100vh-12rem)] max-h-[700px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xl font-bold text-gray-200">Training Records</h3>
            <button 
              onClick={() => {
                removeCache(scopedKey('history'));
                removeCache(scopedKey('historyLastBlock'));
                removeCache(scopedKey('upgradeEvents'));
                removeCache(scopedKey('upgradeLastBlock'));
                removeCache(scopedKey('owned'));
                loadOwned(true);
                showNotification('Cache cleared, reloading', 'info');
              }}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 rounded transition-colors"
            >
              Clear Cache
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <button onClick={() => setActiveTab('training')} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors relative ${activeTab === 'training' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
              {isLoading && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </span>
              )}
              In Progress {trainingList.length > 0 && `(${trainingList.length})`}
            </button>
            <button onClick={() => setActiveTab('success')} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors relative ${activeTab === 'success' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
              {isLoading && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </span>
              )}
              Success {successList.length > 0 && `(${successList.length})`}
            </button>
            <button onClick={() => setActiveTab('failure')} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors relative ${activeTab === 'failure' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
              {isLoading && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </span>
              )}
              Failed {failureList.length > 0 && `(${failureList.length})`}
            </button>
          </div>

          <div className="flex-1 mb-3 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
            {displayRecords.length === 0 ? (
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 text-center">
                <div className="text-4xl mb-3">🏋</div>
                <p className="text-gray-400 text-sm">
                  {activeTab === 'training' ? 'No training in progress' : activeTab === 'success' ? 'No successful training' : 'No failed training'}
                </p>
                {activeTab === 'training' && (
                  <p className="text-xs text-gray-500 mt-1">Select a hero from the right to start training</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {displayRecords.map(record => renderTrainingCard(record))}
              </div>
            )}
          </div>

          <div className="p-3 bg-gray-900/50 border border-gray-700 rounded text-xs text-gray-400 space-y-1">
            <p>• Randomly select an attribute to train</p>
            <p>• Can be completed in 1 minute</p>
            <p>• Only gas required</p>
            <p>• 50% chance to +1</p>
            <p className="text-yellow-400">• Check attributes to confirm training result</p>
          </div>
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col h-[calc(100vh-12rem)] max-h-[700px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xl font-bold text-gray-200">Select Hero</h3>
            <button onClick={() => loadOwned(true)} disabled={isLoading} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded">
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
            {isLoading && owned.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="animate-pulse text-gray-400 mb-2">Loading...</div>
                  <div className="text-xs text-gray-500">Getting your heroes</div>
                </div>
              </div>
            ) : owned.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-4xl mb-3">🎭</div>
                  <p className="text-gray-400 mb-1">No heroes</p>
                  <p className="text-xs text-gray-500">Go to mint page to get your first hero</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {owned.map(nft => {
                const isThisStarting = startingTokens.has(nft.tokenId);
                return (
                  <div key={nft.tokenId} className="relative bg-gray-800 border border-gray-700 hover:border-gray-500 rounded-lg overflow-hidden transition-all">
              <div className="aspect-square bg-gray-900 relative">
                <Image src={nft.imageUrl} alt={nft.className} fill className="object-cover" crossOrigin="anonymous" unoptimized />
                <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-gray-300">#{nft.tokenId}</div>
                {nft.isUpgrading && (
                  <div className="absolute bottom-2 left-2 right-2 text-center text-xs">
                    {Math.ceil(nft.upgradeRemaining || 0) > 0 ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-yellow-700/70 text-yellow-300">Training {Math.ceil(nft.upgradeRemaining || 0)}s</span>
                    ) : (
                            <span className="inline-block px-2 py-0.5 rounded bg-green-700/70 text-green-300">Training complete, click left to finish</span>
                    )}
                  </div>
                )}
              </div>
              <div className="p-2">
                      <div className="text-sm text-gray-200 font-bold truncate mb-2">{nft.className}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button 
                          onClick={() => setSelectedNFT(nft)} 
                          className="py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
                        >
                          View
                        </button>
                        <button 
                          onClick={() => start(nft.tokenId)} 
                          disabled={!isLeftLoaded || isThisStarting || nft.isUpgrading}
                          className="py-1.5 text-xs rounded bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors"
                        >
                          {!isLeftLoaded ? 'Loading...' : nft.isUpgrading ? 'Training...' : isThisStarting ? 'Submitting...' : 'Start Training'}
                        </button>
                      </div>
              </div>
            </div>
                );
              })}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedNFT && (
        <NFTDetailModal
          tokenId={selectedNFT.tokenId}
          classId={selectedNFT.classId}
          className={selectedNFT.className}
          imageUrl={selectedNFT.imageUrl}
          wins={selectedNFT.wins ?? 0}
          losses={selectedNFT.losses ?? 0}
          onClose={() => setSelectedNFT(null)}
        />
      )}
    </div>
  );
}


