'use client';

import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, DarkForestTokenABI, DarkForestNFTABI } from '@/config';
import { initFhevm, getFhevmInstance } from '@/fhevm/fhe-client';
import { useWalletContext } from '@/contexts/WalletContext';
import { useNotificationContext } from '@/contexts/NotificationContext';

export default function QueryDfBalanceBox() {
  const { isConnected } = useWalletContext();
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

  const isZeroHandle = (h: any): boolean => {
    try {
      if (!h) return true;
      const v = typeof h === 'string' ? BigInt(h) : BigInt(h.toString());
      return v === BigInt(0);
    } catch {
      return false;
    }
  };

  const handleQuery = async () => {
    try {
      if (!isConnected) {
        showNotification('Please connect wallet first', 'info');
        return;
      }
      if (!CONTRACT_ADDRESSES.FHE_TOKEN || !CONTRACT_ADDRESSES.NFT_DARK_FOREST) {
        showNotification('Contract address not configured', 'error');
        return;
      }

      setIsLoading(true);

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();

      await initFhevm(window.ethereum, Number(network.chainId), CONTRACT_ADDRESSES.GATEWAY);
      const instance = getFhevmInstance();

      const token = new ethers.Contract(CONTRACT_ADDRESSES.FHE_TOKEN, DarkForestTokenABI, signer);
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, signer);

      const [encBal, pending] = await Promise.all([
        token.balanceOf(userAddress),
        nft.getPendingReward(userAddress)
      ]);

      setPendingReward(pending.toString());

      if (isZeroHandle(encBal)) {
        setBalance('0');
        showNotification('Query successful', 'success');
        return;
      }

      const keypair = instance.generateKeypair();
      const handleContractPairs = [
        { handle: encBal, contractAddress: CONTRACT_ADDRESSES.FHE_TOKEN },
      ];
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [CONTRACT_ADDRESSES.FHE_TOKEN];

      const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays
      );

      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        userAddress,
        startTimeStamp,
        durationDays
      );

      const plain = result[encBal];
      const value = typeof plain === 'bigint' ? plain.toString() : plain.toString();
      setBalance(value);
      showNotification('Query successful', 'success');
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Query cancelled', 'info');
      } else {
        showNotification(`Query failed: ${msg}`, 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshReward = async () => {
    try {
      if (!isConnected) {
        showNotification('Please connect wallet first', 'info');
        return;
      }
      if (!CONTRACT_ADDRESSES.NFT_DARK_FOREST) {
        showNotification('NFT contract address not configured', 'error');
        return;
      }

      setIsRefreshingReward(true);

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, signer);

      const pending = await nft.getPendingReward(userAddress);
      setPendingReward(pending.toString());
      showNotification('Refresh successful', 'success');
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Refresh cancelled', 'info');
      } else {
        showNotification(`Refresh failed: ${msg}`, 'error');
      }
    } finally {
      setIsRefreshingReward(false);
    }
  };

  const handleMint = async () => {
    try {
      if (!isConnected) {
        showNotification('Please connect wallet first', 'info');
        return;
      }
      if (!CONTRACT_ADDRESSES.NFT_DARK_FOREST) {
        showNotification('NFT contract address not configured', 'error');
        return;
      }

      setIsMinting(true);

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.NFT_DARK_FOREST, DarkForestNFTABI, signer);

      const tx = await nft.claimRewards();
      showNotification('Claim transaction submitted, awaiting confirmation...', 'info');

      await tx.wait();
      showNotification('Claim successful!', 'success');

      await handleRefreshReward();
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
        showNotification('Claim cancelled', 'info');
      } else {
        showNotification(`Claim failed: ${msg}`, 'error');
      }
    } finally {
      setIsMinting(false);
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


