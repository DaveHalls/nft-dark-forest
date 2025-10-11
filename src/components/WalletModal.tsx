'use client';

import Image from 'next/image';
import { useWalletContext } from '@/contexts/WalletContext';
import { useState } from 'react';
import type { EIP6963ProviderDetail } from '@/types/wallet';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { availableWallets, connectWallet } = useWalletContext();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConnect = async (wallet: EIP6963ProviderDetail) => {
    try {
      setIsConnecting(true);
      setError(null);
      await connectWallet(wallet);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">Connect Wallet</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl w-8 h-8 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500 rounded-lg text-red-500 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {availableWallets.length > 0 ? (
            availableWallets.map((wallet) => (
              <button
                key={wallet.info.uuid}
                onClick={() => handleConnect(wallet)}
                disabled={isConnecting}
                className="w-full flex items-center gap-4 p-4 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {wallet.info.icon && (
                  <Image
                    src={wallet.info.icon}
                    alt={wallet.info.name}
                    width={40}
                    height={40}
                    className="rounded-lg"
                    unoptimized
                  />
                )}
                <span className="text-white font-medium text-lg">
                  {wallet.info.name}
                </span>
              </button>
            ))
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-400 mb-4">No wallet detected</p>
              <p className="text-sm text-gray-500">
                Please install MetaMask or other EIP-6963 compatible wallet
              </p>
            </div>
          )}
        </div>

        {availableWallets.length === 0 && (
          <div className="mt-6 pt-6 border-t border-gray-800">
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 px-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-center font-medium transition-colors"
            >
              Install MetaMask
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

