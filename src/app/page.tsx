'use client';

import { useState } from "react";
import Image from "next/image";
import WalletConnect from "@/components/WalletConnect";
import QueryDfBalanceBox from "@/components/QueryDfBalanceBox";
import FheStatus from "@/components/FheStatus";
import WelcomeModal from "@/components/WelcomeModal";
import MintSection from "@/components/MintSection";
import MyNFTs from "@/components/MyNFTs";
import Navigation from "@/components/Navigation";
import TrainingSection from "../components/TrainingSection";
import MarketSection from "@/components/MarketSection";
import { useWelcome } from "@/hooks/useWelcome";

export default function Home() {
  const { showWelcome, closeWelcome } = useWelcome();
  const [currentView, setCurrentView] = useState<'mint' | 'forest' | 'train' | 'market'>('mint');

  return (
    <div className="min-h-screen relative">
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/wmremove-transformed.png)' }}
      />
      <div className="fixed inset-0 bg-black/40" />

      <div className="relative z-10">
        {showWelcome && <WelcomeModal onClose={closeWelcome} />}

        <header className="border-b border-gray-800 bg-gray-900/70 backdrop-blur-md sticky top-0 z-30">
          <div className="container mx-auto px-4 py-2">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <Image src="/icons/pixel-eye-red.svg" alt="logo" width={20} height={20} className="inline-block" />
                <h1 className="text-2xl font-bold text-gray-200">
                  NFT Dark Forest
                </h1>
              </div>
              <WalletConnect />
            </div>
            
            <div className="flex justify-between items-center">
              <Navigation 
              currentView={currentView}
              onViewChange={setCurrentView}
              />
              <QueryDfBalanceBox />
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-4">
          {currentView === 'mint' ? (
            <MintSection />
          ) : currentView === 'forest' ? (
            <MyNFTs />
          ) : currentView === 'train' ? (
            <TrainingSection />
          ) : (
            <MarketSection />
          )}
        </main>

        <footer className="border-t border-gray-800 mt-12 py-6">
          <div className="container mx-auto px-4 text-center text-gray-500">
            <p>Powered by Zama FHE Technology</p>
          </div>
        </footer>

        <FheStatus />
      </div>
    </div>
  );
}

// Balance query is extracted to QueryDfBalanceBox component
