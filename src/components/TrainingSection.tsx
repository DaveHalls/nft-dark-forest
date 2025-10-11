'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { ethers } from 'ethers';
import { DarkForestNFTABI, CONTRACT_ADDRESSES } from '@/config';
import { useWalletContext } from '@/contexts/WalletContext';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { ipfsToHttp } from '@/config/ipfs';
import NFTDetailModal from './NFTDetailModal';

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

export default function TrainingSection() {
  const { provider, address, isConnected } = useWalletContext();
  const { showNotification } = useNotificationContext();
  const [isLoading, setIsLoading] = useState(false);
  const [owned, setOwned] = useState<OwnedNFT[]>([]);
  const [startingTokens, setStartingTokens] = useState<Set<number>>(new Set());
  const [finishingTokens, setFinishingTokens] = useState<Set<number>>(new Set());
  
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'training' | 'success' | 'failure'>('training');
  const [selectedNFT, setSelectedNFT] = useState<OwnedNFT | null>(null);
  const [isOperatorApproved, setIsOperatorApproved] = useState(false);
  const [isInfoExpanded, setIsInfoExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trainingInfoExpanded');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  useEffect(() => {
    if (isConnected && provider && address) {
      loadOwned();
    } else {
      setOwned([]);
      setIsOperatorApproved(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, provider, address]);

  const getContract = async () => {
    if (!provider) throw new Error('Provider not ready');
    const signer = await provider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, signer);
  };

  const loadOwned = async (): Promise<OwnedNFT[] | undefined> => {
    if (!provider || !address) return;
    try {
      setIsLoading(true);
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, provider);
      
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 100000);

      // Use Transfer events to find user's NFTs
      const transferToFilter = nft.filters.Transfer(null, address);
      const transferFromFilter = nft.filters.Transfer(address, null);
      
      const [transferToEvents, transferFromEvents] = await Promise.all([
        nft.queryFilter(transferToFilter, fromBlock, 'latest'),
        nft.queryFilter(transferFromFilter, fromBlock, 'latest')
      ]);

      const myTokenIds = new Set<number>();
      
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

      // Batch load NFT data in parallel
      const now = Math.floor(Date.now() / 1000);
      const nftDataPromises = Array.from(myTokenIds).map(async (id) => {
        try {
          const [classId, upgradeState, battleRecord] = await Promise.all([
            nft.getClassId(id),
            nft.getUpgradeState(id).catch(() => ({ inProgress: false, completeAt: 0 })),
            nft.getBattleRecord(id).catch(() => [0, 0])
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

      const list = (await Promise.all(nftDataPromises)).filter((nft): nft is OwnedNFT => nft !== null) as OwnedNFT[];
      
      try {
        const myIds = new Set(list.map(n => n.tokenId));
        const started: Record<number, { completeAt: number; blockNumber: number }> = {};
        const finished: Record<number, number> = {};

        const cacheKey = `upgradeEvents_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
        const lastBlockKey = `lastUpgradeEventBlock_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
        
        let eventFromBlock = fromBlock;
        
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

        const [upStartEvents, upFinishEvents] = await Promise.all([
          nft.queryFilter(nft.filters.UpgradeStarted(), eventFromBlock, 'latest'),
          nft.queryFilter(nft.filters.UpgradeFinished(), eventFromBlock, 'latest')
        ]);

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
          localStorage.setItem(cacheKey, JSON.stringify({ started, finished }));
          localStorage.setItem(lastBlockKey, currentBlock.toString());
        } catch {}
      } catch {}

      setOwned(list);
      
      await loadTrainingHistory(list);
      
      return list;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showNotification(`Failed to load NFT: ${msg}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTrainingHistory = async (nftList: OwnedNFT[]) => {
    if (!provider || nftList.length === 0) return;
    
    try {
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, provider);
      const myTokenIds = new Set(nftList.map(n => n.tokenId));
      
      interface TrainingEvent {
        tokenId: number;
        attrIndex: number;
        blockNumber: number;
        timestamp: number;
        completeAt?: number;
        success?: boolean;
      }
      
      const currentBlock = await provider.getBlockNumber();
      const cacheKey = `trainingHistory_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
      const lastBlockKey = `lastTrainingBlock_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
      
      let cachedStartedEvents: TrainingEvent[] = [];
      let cachedFinishedEvents: TrainingEvent[] = [];
      let fromBlock = Math.max(0, currentBlock - 100000);
      
      try {
        const cachedData = localStorage.getItem(cacheKey);
        const lastBlock = localStorage.getItem(lastBlockKey);
        if (cachedData && lastBlock) {
          const parsed = JSON.parse(cachedData);
          cachedStartedEvents = parsed.started || [];
          cachedFinishedEvents = parsed.finished || [];

          fromBlock = Math.max(parseInt(lastBlock) - 1, 0);
        }
      } catch {}
      
      const startedEvents: TrainingEvent[] = [...cachedStartedEvents];
      const finishedEvents: TrainingEvent[] = [...cachedFinishedEvents];
      
      const [upStartEvents, upFinishEvents] = await Promise.all([
        nft.queryFilter(nft.filters.UpgradeStarted(), fromBlock, 'latest'),
        nft.queryFilter(nft.filters.UpgradeFinished(), fromBlock, 'latest')
      ]);

      const blockCache = new Map<number, number>();
      const getBlockTimestamp = async (blockNumber: number) => {
        if (blockCache.has(blockNumber)) {
          return blockCache.get(blockNumber)!;
        }
        const block = await provider.getBlock(blockNumber);
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
      
      // dedupe by tokenId-attrIndex with most recent blockNumber
      

      const records: TrainingRecord[] = [];
      
      for (const started of startedEvents) {
        const nftInfo = nftList.find(n => n.tokenId === started.tokenId);
        if (!nftInfo) continue;
        
        const matchedFinished = finishedEvents.find(
          f => f.tokenId === started.tokenId && 
               f.attrIndex === started.attrIndex && 
               f.blockNumber > started.blockNumber &&
               f.timestamp >= started.timestamp
        );
        
        if (matchedFinished) {
          records.push({
            tokenId: started.tokenId,
            className: nftInfo.className,
            imageUrl: nftInfo.imageUrl,
            attrIndex: started.attrIndex,
            attrName: ATTR_NAMES[started.attrIndex],
            status: matchedFinished.success ? 'success' : 'failure',
            startTime: started.timestamp,
            completeTime: matchedFinished.timestamp,
            remaining: 0,
          });
        } else {
          const now = Math.floor(Date.now() / 1000);
          const remaining = Math.max(0, (started.completeAt || 0) - now);
          
          records.push({
            tokenId: started.tokenId,
            className: nftInfo.className,
            imageUrl: nftInfo.imageUrl,
            attrIndex: started.attrIndex,
            attrName: ATTR_NAMES[started.attrIndex],
            status: 'training',
            startTime: started.timestamp,
            remaining,
          });
        }
      }
      
      records.sort((a, b) => (b.completeTime || b.startTime) - (a.completeTime || a.startTime));
      setTrainingRecords(records);
      
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          started: startedEvents,
          finished: finishedEvents
        }));
        const maxBlock = Math.max(
          ...startedEvents.map(e => e.blockNumber),
          ...finishedEvents.map(e => e.blockNumber),
          0
        );
        localStorage.setItem(lastBlockKey, String(maxBlock || currentBlock));
      } catch {}
    } catch (e) {
      console.error('Failed to load training history:', e);
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
      
      setOwned(prev => {
        const updated = prev.map(n => n.tokenId === t ? {
          ...n,
          isUpgrading: true,
          upgradeCompleteAt: comp,
          upgradeRemaining: Math.max(0, comp - now),
        } : n);

        // Sync to localStorage cache immediately
        try {
          const cacheKey = `ownedNFTsCache_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
          localStorage.setItem(cacheKey, JSON.stringify(updated));
        } catch (err) {
          console.warn('Failed to update owned NFTs cache:', err);
        }

        return updated;
      });

      const nftInfo = owned.find(n => n.tokenId === t);
      if (nftInfo) {
        setTrainingRecords(prev => {
          const exists = prev.find(r => r.tokenId === t && r.attrIndex === attr && r.status === 'training');
          if (exists) return prev;
          
          const newRecord: TrainingRecord = {
            tokenId: t,
            className: nftInfo.className,
            imageUrl: nftInfo.imageUrl,
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

        // Sync to localStorage cache immediately
        try {
          const cacheKey = `ownedNFTsCache_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
          localStorage.setItem(cacheKey, JSON.stringify(updated));
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
  }, [provider, isConnected, owned, showNotification, address]);

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
    if (!provider) return;
    try {
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, provider);
      const st = await nft.getUpgradeState(id);
      const inProgress = Boolean(st.inProgress ?? st[0]);
      if (!inProgress) {
        setOwned(prev => {
          const updated = prev.map(n => n.tokenId === id ? {
            ...n,
            isUpgrading: false,
            upgradeRemaining: 0,
            upgradeCompleteAt: null,
          } : n);

          // Sync to localStorage cache immediately
          try {
            const cacheKey = `ownedNFTsCache_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
            localStorage.setItem(cacheKey, JSON.stringify(updated));
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

      const tx = await nft.startUpgrade(BigInt(tokenId));
      showNotification('Training start transaction submitted', 'info');
      await tx.wait();
      showNotification('Training started! Can be completed in 1 minute', 'success');
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
      

      const nftRead = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, provider!);
      const st = await nftRead.getUpgradeState(tokenId);
      const completeAt = Number(st.completeAt ?? st[1]);
      const currentBlock = await provider!.getBlock('latest');
      const blockTimestamp = currentBlock!.timestamp;
      
      if (blockTimestamp < completeAt) {
        const remaining = completeAt - blockTimestamp;
        showNotification(`Training not ready yet, please wait ${remaining} seconds`, 'info');
        return;
      }
      
      const nft = await getContract();
      const tx = await nft.finishUpgrade(BigInt(tokenId));
      showNotification('Complete training transaction submitted', 'info');
      await tx.wait();
      await loadUpgradeState(tokenId);
      const updatedList = await loadOwned();
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
    const canFinish = record.status === 'training' && (record.remaining || 0) <= 0;
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
            <p className="text-yellow-400 font-bold text-sm">⏱️ Training {formatTime(record.remaining || 0)}</p>
            {canFinish && (
              <button 
                onClick={() => finish(record.tokenId)}
                disabled={isThisFinishing}
                className="w-full py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded text-xs font-medium transition-colors"
              >
                {isThisFinishing ? 'Submitting...' : 'Complete Training'}
              </button>
            )}
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
                const cacheKey = `trainingHistory_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
                const lastBlockKey = `lastTrainingBlock_${address}_${CONTRACT_ADDRESSES.NFT_DARK_FOREST}`;
                localStorage.removeItem(cacheKey);
                localStorage.removeItem(lastBlockKey);
                loadOwned();
                showNotification('Cache cleared, reloading', 'info');
              }}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 rounded transition-colors"
            >
              Clear Cache
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <button onClick={() => setActiveTab('training')} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${activeTab === 'training' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
              In Progress {trainingList.length > 0 && `(${trainingList.length})`}
            </button>
            <button onClick={() => setActiveTab('success')} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${activeTab === 'success' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
              Success {successList.length > 0 && `(${successList.length})`}
            </button>
            <button onClick={() => setActiveTab('failure')} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${activeTab === 'failure' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
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
            <button onClick={loadOwned} disabled={isLoading} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded">
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
                          disabled={isThisStarting || nft.isUpgrading}
                          className="py-1.5 text-xs rounded bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors"
                        >
                          {nft.isUpgrading ? 'Training...' : isThisStarting ? 'Submitting...' : 'Start Training'}
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


