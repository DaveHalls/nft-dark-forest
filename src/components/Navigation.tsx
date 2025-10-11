'use client';

interface NavigationProps {
  currentView: 'mint' | 'forest' | 'train' | 'market';
  onViewChange: (view: 'mint' | 'forest' | 'train' | 'market') => void;
}

export default function Navigation({ currentView, onViewChange }: NavigationProps) {
  return (
    <nav className="flex gap-2 flex-wrap">
      <button
        onClick={() => onViewChange('mint')}
        className={`
          px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2
          ${currentView === 'mint'
            ? 'bg-blue-600 text-white border border-blue-500 shadow-lg shadow-blue-500/20'
            : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white hover:border-gray-600'
          }
        `}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span>Mint Hero</span>
      </button>
      
      <button
        onClick={() => onViewChange('forest')}
        className={`
          px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2
          ${currentView === 'forest'
            ? 'bg-red-600 text-white border border-red-500 shadow-lg shadow-red-500/20'
            : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white hover:border-gray-600'
          }
        `}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>Battle</span>
      </button>

      <button
        onClick={() => onViewChange('train')}
        className={`
          px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2
          ${currentView === 'train'
            ? 'bg-green-600 text-white border border-green-500 shadow-lg shadow-green-500/20'
            : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white hover:border-gray-600'
          }
        `}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
        <span>Training</span>
      </button>

      <button
        onClick={() => onViewChange('market')}
        className={`
          px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2
          ${currentView === 'market'
            ? 'bg-purple-600 text-white border border-purple-500 shadow-lg shadow-purple-500/20'
            : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white hover:border-gray-600'
          }
        `}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <span>Market</span>
      </button>

      <a
        href="https://github.com/DaveHalls/nft-dark-forest"
        target="_blank"
        rel="noopener noreferrer"
        className="px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white hover:border-gray-600"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
        </svg>
        <span>GitHub</span>
      </a>
    </nav>
  );
}

