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
    </nav>
  );
}

