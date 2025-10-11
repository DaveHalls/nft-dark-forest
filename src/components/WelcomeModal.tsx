'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useWalletContext } from '@/contexts/WalletContext';

interface WelcomeModalProps {
  onClose: () => void;
}

export default function WelcomeModal({ onClose }: WelcomeModalProps) {
  const { address } = useWalletContext();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100);
  }, []);

  const handleEnter = () => {
    const audio = new Audio('/b0b948d809474c19a8b30e1dfdc6cc51.mp3');
    audio.volume = 0.5;
    audio.play().catch(err => console.log('Audio playback failed:', err));
    
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  return (
    <div
      className={`fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className={`bg-gray-900 rounded-xl max-w-4xl w-full border border-gray-700 shadow-2xl transition-all duration-300 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
      >
        {address && (
          <div className="bg-gray-800 border-b border-gray-700 px-6 py-3">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-gray-300 text-sm">Wallet connected:</span>
              <span className="text-blue-400 font-mono font-bold">
                {address.slice(0, 6)}...{address.slice(-4)}
              </span>
            </div>
          </div>
        )}

        <div className="p-8 md:p-12 space-y-8">
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-5xl font-bold text-white">
              Welcome to
            </h1>
            <h2 className="text-5xl md:text-6xl font-black text-blue-500">
              NFT Dark Forest
            </h2>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              NFT Battle Game Based on <span className="text-blue-400 font-semibold">Zama FHE Technology</span>
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/20">
              <div className="mb-4 flex items-center justify-center w-14 h-14 bg-blue-600/20 rounded-lg">
                <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Mint Heroes</h3>
              <p className="text-gray-400 text-sm">
                Create your hero with randomly generated and fully encrypted attributes
              </p>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 hover:border-red-500 transition-all hover:shadow-lg hover:shadow-red-500/20">
              <div className="mb-4 flex items-center justify-center w-14 h-14 bg-red-600/20 rounded-lg">
                <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Battle Arena</h3>
              <p className="text-gray-400 text-sm">
                On-chain battle computation using Fully Homomorphic Encryption
              </p>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 hover:border-green-500 transition-all hover:shadow-lg hover:shadow-green-500/20">
              <div className="mb-4 flex items-center justify-center w-14 h-14 bg-green-600/20 rounded-lg">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Earn Rewards</h3>
              <p className="text-gray-400 text-sm">
                Win battles to earn 1000 encrypted tokens
              </p>
            </div>
          </div>

          <div className="pt-6 pb-6 flex flex-col items-center justify-center">
            <button
              onClick={handleEnter}
              className="px-12 py-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold text-white text-lg transition-all hover:scale-105 shadow-lg flex items-center gap-3"
            >
              <Image src="/icons/pixel-eye-red.svg" alt="logo" width={24} height={24} />
              <span>Enter Dark Forest</span>
            </button>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 md:p-8">
            <h3 className="text-2xl font-bold text-center mb-6 text-white">
              How to Start?
            </h3>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-gray-700 border border-gray-600 rounded flex items-center justify-center font-bold text-gray-300">
                  1
                </div>
                <div className="flex-1 pt-1">
                  <p className="text-gray-200 font-medium">
                    Connect your wallet (MetaMask supported)
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-gray-700 border border-gray-600 rounded flex items-center justify-center font-bold text-gray-300">
                  2
                </div>
                <div className="flex-1 pt-1">
                  <p className="text-gray-200 font-medium">
                    Mint your first NFT warrior
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-gray-700 border border-gray-600 rounded flex items-center justify-center font-bold text-gray-300">
                  3
                </div>
                <div className="flex-1 pt-1">
                  <p className="text-gray-200 font-medium">
                    Start battling and earn rewards
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center pt-4 border-t border-gray-700">
            <p className="text-xs text-gray-500">
              Powered by <span className="text-blue-400 font-semibold">Zama FHE Technology</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

