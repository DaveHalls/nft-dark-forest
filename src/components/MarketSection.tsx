'use client';

import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import Image from 'next/image';
import { CONTRACT_ADDRESSES, DarkForestNFTABI, DarkForestMarketABI } from '@/config';
import { useWalletContext } from '@/contexts/WalletContext';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { ipfsToHttp } from '@/config/ipfs';
import { isNetworkSwitchError } from '@/utils/errorHandler';
import { readWithFallback } from '@/lib/provider';

interface ListingItem {
  tokenId: number;
  price: string;
  seller: string;
  imageUrl: string;
  name: string;
  wins: number;
  losses: number;
  winRate: number;
}

interface MyItem {
  tokenId: number;
  imageUrl: string;
  name: string;
  wins: number;
  losses: number;
  winRate: number;
}

export default function MarketSection() {
  const { provider, isConnected, address } = useWalletContext();
  const { showNotification } = useNotificationContext();
  const [items, setItems] = useState<ListingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'market' | 'my'>('market');

  // My NFTs
  const [myItems, setMyItems] = useState<MyItem[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [priceEth, setPriceEth] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!isConnected || !provider) return;
    void loadListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, provider]);

  const loadListings = async () => {
    try {
      if (!CONTRACT_ADDRESSES.MARKET) {
        showNotification('MARKET address not configured', 'error');
        return;
      }
      setLoading(true);
      const supply = Number(await readWithFallback((p) => 
        new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).totalSupply()
      ));
      const list: ListingItem[] = [];
      for (let id = 1; id <= supply; id++) {
        try {
          const res = await readWithFallback((p) => 
            new ethers.Contract(CONTRACT_ADDRESSES.MARKET, DarkForestMarketABI, p).getListing(id)
          );
          const seller = res[0] as string;
          const price = (res[1] as bigint).toString();
          const active = Boolean(res[2]);
          if (!active) continue;
          const classId = Number(await readWithFallback((p) => 
            new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getClassId(id)
          ));
          const name = await readWithFallback((p) => 
            new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getClass(id)
          );
          const imageCid = [
            'bafkreifkvbyytyqi7z66a7q2k5kzoxxc7osevdafmmbvm2mbfkiyao5nie',
            'bafkreicox4d3grjebxqv62vsq7bedpfbogx3qfmul5sxwfcp4ud6gqueui',
            'bafkreigi5srff2asnxwkhqbobc2vsbe45bassbaspqerkikofot4mmylue',
            'bafkreidvir3s5ml6cldydcrow7yguyw762fghnv27qeecvxw67ireakbna',
            'bafkreiem43q74cdoy2kpn3hwopdgumis2l6znsmjv3jpmpxjpmchf3hhom'
          ][classId];
          let wins = 0, losses = 0, winRate = 0;
          try {
            const stats = await readWithFallback((p) => 
              new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getBattleStats(id)
            );
            if (stats && typeof stats === 'object') {
              const statsArray = stats as Record<number, unknown> & { wins?: unknown; losses?: unknown; winRate?: unknown };
              wins = Number(statsArray[0] ?? statsArray.wins ?? 0);
              losses = Number(statsArray[1] ?? statsArray.losses ?? 0);
              winRate = Number(statsArray[3] ?? statsArray.winRate ?? 0);
            } else {
              throw new Error('getBattleStats unavailable');
            }
          } catch {
            try {
              const rec = await readWithFallback((p) => 
                new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getBattleRecord(id)
              );
              if (rec && typeof rec === 'object') {
                const recArray = rec as Record<number, unknown> & { wins?: unknown; losses?: unknown };
                wins = Number(recArray[0] ?? recArray.wins ?? 0);
                losses = Number(recArray[1] ?? recArray.losses ?? 0);
                const total = wins + losses;
                winRate = total > 0 ? Math.floor((wins * 10000) / total) : 0;
              }
            } catch {}
          }
          list.push({ tokenId: id, price, seller, name, imageUrl: ipfsToHttp(`ipfs://${imageCid}`), wins, losses, winRate });
        } catch {}
      }
      setItems(list);
    } catch (e: unknown) {
      if (isNetworkSwitchError(e)) {
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      showNotification(`Failed to load market: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async (tokenId: number, price: string) => {
    try {
      if (!provider) return;
      try { await (provider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> }).send('eth_requestAccounts', []); } catch {}
      const signer = await provider.getSigner();
      const market = new ethers.Contract(CONTRACT_ADDRESSES.MARKET, DarkForestMarketABI, signer);
      showNotification('Please confirm the transaction in your wallet', 'info');
      const tx = await market.buy(tokenId, { value: price });
      showNotification('Purchase transaction submitted', 'info');
      await tx.wait();
      showNotification('Purchase successful', 'success');
      await loadListings();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Purchase cancelled', 'info');
      } else {
        showNotification(`Purchase failed: ${msg}`, 'error');
      }
    }
  };

  const loadMyNFTs = async () => {
    try {
      if (!provider || !address) return;
      setMyLoading(true);
      
      let myTokenIds: number[] = [];
      
      try {
        const tokenIds = await readWithFallback((p) => 
          new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).tokensOfOwner(address)
        );
        myTokenIds = tokenIds.map((id: bigint) => Number(id));
      } catch {
        console.warn('Contract method tokensOfOwner not available, falling back to iteration');
        const supply = Number(await readWithFallback((p) => 
          new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).totalSupply()
        ));
        for (let id = 1; id <= supply; id++) {
          try {
            const owner = await readWithFallback((p) => 
              new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).ownerOf(id)
            );
            if (owner.toLowerCase() === address.toLowerCase()) {
              myTokenIds.push(id);
            }
          } catch {}
        }
      }
      
      const list: MyItem[] = [];
      for (const id of myTokenIds) {
        try {
          const classId = Number(await readWithFallback((p) => 
            new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getClassId(id)
          ));
          const name = await readWithFallback((p) => 
            new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getClass(id)
          );
          const imageCid = [
            'bafkreifkvbyytyqi7z66a7q2k5kzoxxc7osevdafmmbvm2mbfkiyao5nie',
            'bafkreicox4d3grjebxqv62vsq7bedpfbogx3qfmul5sxwfcp4ud6gqueui',
            'bafkreigi5srff2asnxwkhqbobc2vsbe45bassbaspqerkikofot4mmylue',
            'bafkreidvir3s5ml6cldydcrow7yguyw762fghnv27qeecvxw67ireakbna',
            'bafkreiem43q74cdoy2kpn3hwopdgumis2l6znsmjv3jpmpxjpmchf3hhom'
          ][classId];
          let wins = 0, losses = 0, winRate = 0;
          try {
            const stats = await readWithFallback((p) => 
              new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getBattleStats(id)
            );
            if (stats && typeof stats === 'object') {
              const statsArray = stats as Record<number, unknown> & { wins?: unknown; losses?: unknown; winRate?: unknown };
              wins = Number(statsArray[0] ?? statsArray.wins ?? 0);
              losses = Number(statsArray[1] ?? statsArray.losses ?? 0);
              winRate = Number(statsArray[3] ?? statsArray.winRate ?? 0);
            } else {
              throw new Error('getBattleStats unavailable');
            }
          } catch {
            try {
              const rec = await readWithFallback((p) => 
                new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getBattleRecord(id)
              );
              if (rec && typeof rec === 'object') {
                const recArray = rec as Record<number, unknown> & { wins?: unknown; losses?: unknown };
                wins = Number(recArray[0] ?? recArray.wins ?? 0);
                losses = Number(recArray[1] ?? recArray.losses ?? 0);
                const total = wins + losses;
                winRate = total > 0 ? Math.floor((wins * 10000) / total) : 0;
              }
            } catch {}
          }
          list.push({ tokenId: id, name, imageUrl: ipfsToHttp(`ipfs://${imageCid}`), wins, losses, winRate });
        } catch {}
      }
      setMyItems(list);
    } catch (e: unknown) {
      if (isNetworkSwitchError(e)) {
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      showNotification(`Failed to load my NFTs: ${msg}`, 'error');
    } finally {
      setMyLoading(false);
    }
  };

  useEffect(() => {
    if (!isConnected || !provider) return;
    if (activeTab === 'my') void loadMyNFTs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isConnected, provider]);

  const handleList = async (tokenId: number) => {
    try {
      if (!provider) return;
      if (!CONTRACT_ADDRESSES.MARKET) {
        showNotification('MARKET address not configured', 'error');
        return;
      }
      const v = (priceEth[tokenId] || '').trim();
      if (!v || Number(v) <= 0) {
        showNotification('Please enter a valid price', 'error');
        return;
      }
      setBusy(prev => ({ ...prev, [tokenId]: true }));
      try { await (provider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> }).send('eth_requestAccounts', []); } catch {}
      const signer = await provider.getSigner();
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, signer);
      const market = new ethers.Contract(CONTRACT_ADDRESSES.MARKET, DarkForestMarketABI, signer);
      const approved = await nft.getApproved(tokenId);
      if (approved.toLowerCase() !== CONTRACT_ADDRESSES.MARKET.toLowerCase()) {
        showNotification('Please confirm the approval transaction in your wallet', 'info');
        const txA = await nft.approve(CONTRACT_ADDRESSES.MARKET, tokenId);
        showNotification('Market approval transaction submitted', 'info');
        await txA.wait();
      }
      const wei = ethers.parseEther(v);
      showNotification('Please confirm the listing transaction in your wallet', 'info');
      const tx = await market.list(tokenId, wei);
      showNotification('Listing transaction submitted', 'info');
      await tx.wait();
      showNotification('Listed successfully', 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Listing cancelled', 'info');
      } else {
        showNotification(`Listing failed: ${msg}`, 'error');
      }
    } finally {
      setBusy(prev => ({ ...prev, [tokenId]: false }));
    }
  };

  if (!isConnected) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center text-gray-400">Please connect wallet first</div>
    );
  }

  if (!CONTRACT_ADDRESSES.MARKET) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center text-gray-400">MARKET address not configured</div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('market')}
            className={`px-3 py-1.5 text-sm rounded ${activeTab === 'market' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700'}`}
          >Market</button>
          <button
            onClick={() => setActiveTab('my')}
            className={`px-3 py-1.5 text-sm rounded ${activeTab === 'my' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700'}`}
          >My NFTs</button>
        </div>
        {activeTab === 'market' ? (
          <button onClick={loadListings} disabled={loading} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded">{loading ? 'Refreshing...' : 'Refresh'}</button>
        ) : (
          <button onClick={loadMyNFTs} disabled={myLoading} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded">{myLoading ? 'Refreshing...' : 'Refresh'}</button>
        )}
      </div>

      {activeTab === 'market' ? (
        loading ? (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
            <div className="flex flex-col items-center justify-center space-y-3">
              <svg className="animate-spin h-10 w-10 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-gray-400 text-sm">Loading market listings...</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center text-gray-400">No NFTs for sale</div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {items.map(it => (
               <div key={it.tokenId} className="bg-gray-800 border border-gray-700 rounded overflow-hidden">
                <div className="aspect-square bg-gray-900 relative">
                  <Image src={it.imageUrl} alt={it.name} fill className="object-cover" crossOrigin="anonymous" unoptimized />
                  <div className="absolute top-1 right-1 bg-black/70 px-1 py-0.5 rounded text-[10px] text-gray-300">#{it.tokenId}</div>
                </div>
                 <div className="p-1.5 space-y-1">
                   <div className="text-xs font-bold text-gray-200 truncate">{it.name}</div>
                  
                   <div className="text-xs font-medium text-green-400">
                     {it.wins}W {it.losses}L Win Rate: {(it.winRate / 100).toFixed(0)}%
                   </div>
                   <button onClick={() => handleBuy(it.tokenId, it.price)} className="w-full py-1 text-[10px] rounded bg-green-600 hover:bg-green-700 text-white font-medium">
                     Buy {ethers.formatEther(it.price)} ETH
                   </button>
                 </div>
               </div>
            ))}
          </div>
        )
      ) : (
        myLoading ? (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
            <div className="flex flex-col items-center justify-center space-y-3">
              <svg className="animate-spin h-10 w-10 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-gray-400 text-sm">Loading your NFTs...</p>
            </div>
          </div>
        ) : myItems.length === 0 ? (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center text-gray-400">You don&apos;t have any NFTs yet</div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
             {myItems.map(it => (
               <div key={it.tokenId} className="bg-gray-800 border border-gray-700 rounded overflow-hidden">
                <div className="aspect-square bg-gray-900 relative">
                  <Image src={it.imageUrl} alt={it.name} fill className="object-cover" crossOrigin="anonymous" unoptimized />
                  <div className="absolute top-1 right-1 bg-black/70 px-1 py-0.5 rounded text-[10px] text-gray-300">#{it.tokenId}</div>
                </div>
                 <div className="p-1.5">
                   <div className="text-xs font-bold text-gray-200 truncate mb-0.5">{it.name}</div>
                  
                   <div className="text-xs font-medium text-green-400 truncate mb-1">{it.wins}W {it.losses}L Win Rate: {(it.winRate / 100).toFixed(0)}%</div>
                   <div className="flex items-center gap-1">
                     <input
                       placeholder="ETH"
                       value={priceEth[it.tokenId] || ''}
                       onChange={(e) => setPriceEth(prev => ({ ...prev, [it.tokenId]: e.target.value }))}
                       className="flex-1 min-w-0 px-1 py-0.5 text-[10px] bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-500"
                     />
                     <button
                       onClick={() => handleList(it.tokenId)}
                       disabled={busy[it.tokenId]}
                       className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-green-600 hover:bg-green-700 text-white disabled:bg-gray-700 whitespace-nowrap"
                     >{busy[it.tokenId] ? 'Listing...' : 'List'}</button>
                   </div>
                 </div>
               </div>
             ))}
          </div>
        )
      )}
    </div>
  );
}


