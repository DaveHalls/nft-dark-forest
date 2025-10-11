'use client';

import { useWalletContext } from '@/contexts/WalletContext';
import { formatAddress } from '@/lib/utils';
import { useState } from 'react';
import WalletModal from './WalletModal';

export default function WalletConnect() {
  const { address, isConnected, disconnectWallet } = useWalletContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
          <span className="font-medium">{formatAddress(address)}</span>
        </button>

        {showMenu && (
          <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 overflow-hidden z-50">
            <div className="px-4 py-3 border-b border-gray-700">
              <p className="text-xs text-gray-400">Connected</p>
              <p className="text-sm text-white font-mono">{formatAddress(address)}</p>
            </div>
            <button
              onClick={() => {
                disconnectWallet();
                setShowMenu(false);
              }}
              className="w-full px-4 py-2 text-left text-red-400 hover:bg-gray-700 transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}

        {showMenu && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowMenu(false)}
          ></div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="px-6 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-lg transition-colors font-medium"
      >
        Connect Wallet
      </button>
      <WalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}

