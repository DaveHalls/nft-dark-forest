'use client';

import Image from 'next/image';
import { useState } from 'react';

interface HeroCardProps {
  classId: number;
  className: string;
  imageUrl: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
}

export default function HeroCard({ 
  classId, 
  className, 
  imageUrl, 
  description,
  onClick,
  disabled = false
}: HeroCardProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <div 
      className={`
        group bg-gray-800 border border-gray-700 rounded-lg overflow-hidden
        transition-all duration-300
        hover:border-blue-500 hover:-translate-y-1 hover:shadow-lg hover:shadow-blue-500/10
        ${onClick && !disabled ? 'cursor-pointer' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
      onClick={!disabled && onClick ? onClick : undefined}
    >
      <div className="aspect-square bg-gray-900 relative overflow-hidden">
        {imgError ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-800">
            <span className="text-gray-500 text-4xl">🎭</span>
          </div>
        ) : (
          <Image
            src={imageUrl}
            alt={className}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            crossOrigin="anonymous"
            onError={() => setImgError(true)}
            unoptimized
          />
        )}
        <div className="absolute top-2 right-2 bg-black/70 px-3 py-1 rounded z-10">
          <span className="text-sm text-gray-300">Class #{classId}</span>
        </div>
      </div>
      
      <div className="p-4">
        <h3 className="text-lg font-bold text-gray-200 mb-2">{className}</h3>
        <p className="text-sm text-gray-400">{description}</p>
      </div>
    </div>
  );
}

