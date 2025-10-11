'use client';

import { DEFAULT_CHAIN } from '@/config/chains';

interface NetworkSwitchPromptProps {
  onSwitch: () => Promise<void>;
}

export default function NetworkSwitchPrompt({ onSwitch }: NetworkSwitchPromptProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900 flex items-center justify-center">
            <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Network Switch Required
          </h3>
        </div>
        
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Current network is incorrect. Please switch to <span className="font-semibold text-blue-600 dark:text-blue-400">{DEFAULT_CHAIN.chainName}</span> network to use the application.
        </p>

        <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 mb-6 text-sm">
          <div className="flex justify-between mb-2">
            <span className="text-gray-500">Network Name:</span>
            <span className="font-medium text-gray-900 dark:text-white">{DEFAULT_CHAIN.chainName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Chain ID:</span>
            <span className="font-medium text-gray-900 dark:text-white">{parseInt(DEFAULT_CHAIN.chainId, 16)}</span>
          </div>
        </div>

        <button
          onClick={onSwitch}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
        >
          Switch to {DEFAULT_CHAIN.chainName}
        </button>
      </div>
    </div>
  );
}

