'use client';

import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import type { Eip1193Provider } from 'ethers';
import { CONTRACT_ADDRESSES, DarkForestTokenABI, DarkForestNFTABI } from '@/config';
import { readWithFallback, requestAccountsOrThrow, sendTxWithPopup } from '@/lib/provider';
import { initFhevm, getFhevmInstance } from '@/fhevm/fhe-client';
import { useWalletContext } from '@/contexts/WalletContext';
import { useNotificationContext } from '@/contexts/NotificationContext';

interface FheInstance {
  generateKeypair: () => { publicKey: string; privateKey: string };
  createEIP712: (publicKey: string, contractAddresses: string[], startTimeStamp: string, durationDays: string) => { domain: Record<string, unknown>; types: { UserDecryptRequestVerification: Array<{ name: string; type: string }> }; message: Record<string, unknown> };
  userDecrypt: (handleContractPairs: Array<{ handle: unknown; contractAddress: string }>, privateKey: string, publicKey: string, signature: string, contractAddress: string[], userAddress: string, startTimeStamp: string, durationDays: string) => Promise<Record<string, bigint | string>>;
}

export default function QueryDfBalanceBox() {
  const { isConnected, provider, address } = useWalletContext();
  const { showNotification } = useNotificationContext();
  const [isLoading, setIsLoading] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [isRefreshingReward, setIsRefreshingReward] = useState(false);
  const [balance, setBalance] = useState<string>('***');
  const [pendingReward, setPendingReward] = useState<string>('—');
  const [isContractDropdownOpen, setIsContractDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsContractDropdownOpen(false);
      }
    };

    if (isContractDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isContractDropdownOpen]);

  const isZeroHandle = (h: unknown): boolean => {
    try {
      if (!h) return true;
      const v = typeof h === 'string' ? BigInt(h) : BigInt((h as { toString: () => string }).toString());
      return v === BigInt(0);
    } catch {
      return false;
    }
  };

  const handleQuery = async () => {
    try {
      if (process.env.NODE_ENV !== 'production') console.log('[Query] start');
      if (!isConnected) {
        showNotification('Please connect wallet first', 'info');
        if (process.env.NODE_ENV !== 'production') console.log('[Query] not connected');
        return;
      }
      if (!CONTRACT_ADDRESSES.FHE_TOKEN || !CONTRACT_ADDRESSES.NFT_DARK_FOREST) {
        showNotification('Contract address not configured', 'error');
        if (process.env.NODE_ENV !== 'production') console.error('[Query] missing contract address', CONTRACT_ADDRESSES);
        return;
      }

      setIsLoading(true);

      const network = await readWithFallback((p) => p.getNetwork());
      const userAddress = address
        ? address
        : (async () => {
            const ep = provider
              ? provider
              : (typeof window !== 'undefined' && (window as unknown as { ethereum?: Eip1193Provider }).ethereum
                  ? new ethers.BrowserProvider((window as unknown as { ethereum: Eip1193Provider }).ethereum as Eip1193Provider)
                  : null);
            if (!ep) throw new Error('Wallet not available');
            const s = await ep.getSigner();
            return s.getAddress();
          })();
      const resolvedUserAddress = typeof userAddress === 'string' ? userAddress : await userAddress;
      if (process.env.NODE_ENV !== 'production') console.log('[Query] network/address', { chainId: network.chainId, userAddress: resolvedUserAddress });

      const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
      if (process.env.NODE_ENV !== 'production') console.log('[Query] initFhevm', { rpcUrl, gateway: CONTRACT_ADDRESSES.GATEWAY });
      await initFhevm(rpcUrl, Number(network.chainId), CONTRACT_ADDRESSES.GATEWAY);
      if (process.env.NODE_ENV !== 'production') console.log('[Query] initFhevm ok');
      const instance = getFhevmInstance();

      if (process.env.NODE_ENV !== 'production') console.log('[Query] fetching balance/pending ...');
      const [encBal, pending] = await Promise.all([
        readWithFallback((p) => 
          new ethers.Contract(CONTRACT_ADDRESSES.FHE_TOKEN, DarkForestTokenABI, p).balanceOf(resolvedUserAddress, { from: resolvedUserAddress })
        ),
        readWithFallback((p) => 
          new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getPendingReward(resolvedUserAddress)
        )
      ]);
      if (process.env.NODE_ENV !== 'production') console.log('[Query] balance/pending fetched', { encBal, pending: pending?.toString?.() });

      setPendingReward(pending.toString());

      if (isZeroHandle(encBal)) {
        setBalance('0');
        showNotification('Query successful', 'success');
        if (process.env.NODE_ENV !== 'production') console.log('[Query] zero handle => 0');
        return;
      }

      const keypair = (instance as FheInstance).generateKeypair();
      if (process.env.NODE_ENV !== 'production') console.log('[Query] keypair generated');
      const handleContractPairs = [
        { handle: encBal, contractAddress: CONTRACT_ADDRESSES.FHE_TOKEN },
      ];
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [CONTRACT_ADDRESSES.FHE_TOKEN];

      const eip712 = (instance as FheInstance).createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays
      );
      if (process.env.NODE_ENV !== 'production') console.log('[Query] EIP712 ready');

      // Only now require wallet for signing
      const ep = provider
        ? provider
        : (typeof window !== 'undefined' && (window as unknown as { ethereum?: Eip1193Provider }).ethereum
            ? new ethers.BrowserProvider((window as unknown as { ethereum: Eip1193Provider }).ethereum as Eip1193Provider)
            : null);
      if (!ep) {
        showNotification('Wallet not available', 'error');
        if (process.env.NODE_ENV !== 'production') console.error('[Query] no provider for signing');
        return;
      }
      try {
        await requestAccountsOrThrow(ep as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
          showNotification('Query cancelled', 'info');
          return;
        }
        throw err;
      }
      const signer = await ep.getSigner();
      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );
      if (process.env.NODE_ENV !== 'production') console.log('[Query] signature ok');

      const result = await (instance as FheInstance).userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        resolvedUserAddress,
        startTimeStamp,
        durationDays
      );
      if (process.env.NODE_ENV !== 'production') console.log('[Query] userDecrypt ok');

      const plain = result[encBal];
      const value = typeof plain === 'bigint' ? plain.toString() : plain.toString();
      setBalance(value);
      showNotification('Query successful', 'success');
      if (process.env.NODE_ENV !== 'production') console.log('[Query] done', { value });
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.error('[Query] error', e);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Query cancelled', 'info');
      } else {
        showNotification(`Query failed: ${msg}`, 'error');
      }
    } finally {
      setIsLoading(false);
      if (process.env.NODE_ENV !== 'production') console.log('[Query] end');
    }
  };

  const handleRefreshReward = async () => {
    try {
      if (process.env.NODE_ENV !== 'production') console.log('[RefreshReward] start');
      if (!isConnected) {
        showNotification('Please connect wallet first', 'info');
        if (process.env.NODE_ENV !== 'production') console.log('[RefreshReward] not connected');
        return;
      }
      if (!CONTRACT_ADDRESSES.NFT_DARK_FOREST) {
        showNotification('NFT contract address not configured', 'error');
        if (process.env.NODE_ENV !== 'production') console.error('[RefreshReward] missing NFT address');
        return;
      }

      setIsRefreshingReward(true);

      const userAddr = address;
      if (!userAddr) {
        showNotification('Wallet not available', 'error');
        if (process.env.NODE_ENV !== 'production') console.error('[RefreshReward] no address');
        return;
      }

      const pending = await readWithFallback((p) => 
        new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, p).getPendingReward(userAddr)
      );
      setPendingReward(pending.toString());
      showNotification('Refresh successful', 'success');
      if (process.env.NODE_ENV !== 'production') console.log('[RefreshReward] done', { pending: pending?.toString?.() });
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.error('[RefreshReward] error', e);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Refresh cancelled', 'info');
      } else {
        showNotification(`Refresh failed: ${msg}`, 'error');
      }
    } finally {
      setIsRefreshingReward(false);
      if (process.env.NODE_ENV !== 'production') console.log('[RefreshReward] end');
    }
  };

  const handleMint = async () => {
    try {
      if (process.env.NODE_ENV !== 'production') console.log('[Claim] start');
      if (!isConnected) {
        showNotification('Please connect wallet first', 'info');
        if (process.env.NODE_ENV !== 'production') console.log('[Claim] not connected');
        return;
      }
      if (!CONTRACT_ADDRESSES.NFT_DARK_FOREST) {
        showNotification('NFT contract address not configured', 'error');
        if (process.env.NODE_ENV !== 'production') console.error('[Claim] missing NFT address');
        return;
      }

      setIsMinting(true);

      const ethProvider = provider
        ? provider
        : (typeof window !== 'undefined' && (window as unknown as { ethereum?: Eip1193Provider }).ethereum
            ? new ethers.BrowserProvider((window as unknown as { ethereum: Eip1193Provider }).ethereum as Eip1193Provider)
            : null);
      if (!ethProvider) {
        showNotification('Wallet not available', 'error');
        if (process.env.NODE_ENV !== 'production') console.error('[Claim] no provider');
        return;
      }
      // Ensure wallet popup and send tx with unified flow
      try {
        await requestAccountsOrThrow(ethProvider as unknown as { send: (m: string, p?: unknown[]) => Promise<unknown> });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
          showNotification('Claim cancelled', 'info');
          return;
        }
        throw err;
      }
      const signer = await ethProvider.getSigner();
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, signer);
      const data = nft.interface.encodeFunctionData('claimRewards', []);
      const receipt = await sendTxWithPopup({
        provider: ethProvider as unknown as ethers.BrowserProvider & { send: (m: string, p?: unknown[]) => Promise<unknown> },
        signer,
        to: CONTRACT_ADDRESSES.NFT_DARK_FOREST,
        data,
        fallbackSend: async () => {
          const tx = await nft.claimRewards();
          return { hash: tx.hash };
        },
        notify: (m, t) => showNotification(m, t),
        pendingTip: 'Transaction submitted but not confirmed yet',
      });
      if (!receipt) return;
      showNotification('Claim successful!', 'success');

      await handleRefreshReward();
      if (process.env.NODE_ENV !== 'production') console.log('[Claim] done');
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.error('[Claim] error', e);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Claim cancelled', 'info');
      } else {
        showNotification(`Claim failed: ${msg}`, 'error');
      }
    } finally {
      setIsMinting(false);
      if (process.env.NODE_ENV !== 'production') console.log('[Claim] end');
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showNotification(`${label} copied`, 'success');
    }).catch(() => {
      showNotification('Copy failed', 'error');
    });
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-3">
      <div className="flex items-center gap-3">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsContractDropdownOpen(!isContractDropdownOpen)}
            className="px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 flex items-center gap-1"
          >
            <span className="text-xs">CA</span>
            <span className={`transition-transform text-xs ${isContractDropdownOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>
          
          {isContractDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50 min-w-[300px]">
              <div className="p-2 space-y-2">
                <div className="flex items-center justify-between gap-2 p-2 bg-gray-900 rounded hover:bg-gray-700 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-400 mb-0.5">NFT Contract</div>
                    <div className="text-sm text-gray-200 font-mono truncate" title={CONTRACT_ADDRESSES.NFT_DARK_FOREST}>
                      {formatAddress(CONTRACT_ADDRESSES.NFT_DARK_FOREST)}
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(CONTRACT_ADDRESSES.NFT_DARK_FOREST, 'NFT Contract Address')}
                    className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors flex-shrink-0"
                  >
                    Copy
                  </button>
                </div>
                
                <div className="flex items-center justify-between gap-2 p-2 bg-gray-900 rounded hover:bg-gray-700 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-400 mb-0.5">Token Contract</div>
                    <div className="text-sm text-gray-200 font-mono truncate" title={CONTRACT_ADDRESSES.FHE_TOKEN}>
                      {formatAddress(CONTRACT_ADDRESSES.FHE_TOKEN)}
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(CONTRACT_ADDRESSES.FHE_TOKEN, 'Token Contract Address')}
                    className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors flex-shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-between gap-2 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 min-w-[160px]">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">Reward</span>
              <span className="text-green-400 text-sm truncate" title={`${pendingReward} DF`}>{pendingReward} <span className="text-gray-500">DF</span></span>
            </div>
            <button
              onClick={handleRefreshReward}
              disabled={isRefreshingReward}
              className="text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-60"
              title="Refresh reward amount"
            >
              <span className={isRefreshingReward ? 'inline-block animate-spin text-base' : 'text-base'}>⟳</span>
            </button>
          </div>
          <button
            onClick={handleMint}
            disabled={isMinting || pendingReward === '—' || pendingReward === '0'}
            className="px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors bg-green-700 text-white border border-green-600 hover:bg-green-600 disabled:opacity-60 disabled:bg-gray-800 disabled:text-gray-400 disabled:border-gray-700"
          >
            {isMinting ? 'Claiming...' : 'Claim'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 min-w-[140px]">
            <span className="text-gray-400 text-sm">$DF</span>
            <span className="text-gray-200 text-sm truncate" title={balance}>{balance}</span>
          </div>
          <button
            onClick={handleQuery}
            disabled={isLoading}
            className="px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 disabled:opacity-60"
          >
            {isLoading ? 'Querying...' : 'Query'}
          </button>
        </div>
      </div>
    </div>
  );
}


