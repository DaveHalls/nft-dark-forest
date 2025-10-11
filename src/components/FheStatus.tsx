'use client';

import { useFhe } from '@/contexts/FheContext';
import { useFheInstance } from '@/hooks/useFheInstance';
import { useWalletContext } from '@/contexts/WalletContext';
import NetworkSwitchPrompt from './NetworkSwitchPrompt';

export default function FheStatus() {
  const { isInitialized: sdkInitialized, error: sdkError } = useFhe();
  const { isReady: instanceReady, isLoading: instanceLoading, error: instanceError, needsNetworkSwitch, switchNetwork } = useFheInstance();
  const { isConnected } = useWalletContext();

  if (!isConnected) {
    return null;
  }

  return (
    <>
      {needsNetworkSwitch && <NetworkSwitchPrompt onSwitch={switchNetwork} />}
      
      <div className="fixed bottom-4 left-4 bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm space-y-1 z-40">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${sdkInitialized ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
          <span className="text-gray-300">FHE SDK: {sdkInitialized ? 'Initialized' : 'Initializing...'}</span>
        </div>
        
        {isConnected && (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${instanceReady ? 'bg-green-400' : instanceLoading ? 'bg-yellow-400' : needsNetworkSwitch ? 'bg-orange-400' : 'bg-red-400'}`}></div>
            <span className="text-gray-300">
              FHE Instance: {instanceReady ? 'Ready' : instanceLoading ? 'Loading...' : needsNetworkSwitch ? 'Waiting for network switch' : 'Not ready'}
            </span>
          </div>
        )}

        {!needsNetworkSwitch && (sdkError || instanceError) && (
          <div className="text-red-400 text-xs mt-2">
            {sdkError || instanceError}
          </div>
        )}
      </div>
    </>
  );
}

