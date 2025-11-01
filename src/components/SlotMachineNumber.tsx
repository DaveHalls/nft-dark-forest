'use client';

import { useEffect, useState, useRef } from 'react';

interface SlotMachineNumberProps {
  value: number;
  isSpinning: boolean;
}

export default function SlotMachineNumber({ value, isSpinning }: SlotMachineNumberProps) {
  const digits = value.toString().padStart(2, '0').split('');
  
  return (
    <span className="inline-flex gap-0.5">
      {digits.map((digit, index) => (
        <SlotDigit 
          key={index} 
          digit={parseInt(digit)} 
          isSpinning={isSpinning}
          delay={index * 200}
        />
      ))}
    </span>
  );
}

interface SlotDigitProps {
  digit: number;
  isSpinning: boolean;
  delay: number;
}

function SlotDigit({ digit, isSpinning, delay }: SlotDigitProps) {
  const [currentDigit, setCurrentDigit] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const pulseIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isSpinning) {
      setIsPulsing(false);
      if (pulseIntervalRef.current) {
        clearInterval(pulseIntervalRef.current);
        pulseIntervalRef.current = null;
      }
      
      setTimeout(() => {
        setIsAnimating(true);
        intervalRef.current = setInterval(() => {
          setCurrentDigit(prev => (prev + 1) % 10);
        }, 50);
      }, delay);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      
      setTimeout(() => {
        setCurrentDigit(digit);
        setIsAnimating(false);
        
        setTimeout(() => {
          pulseIntervalRef.current = setInterval(() => {
            setIsPulsing(true);
            setTimeout(() => setIsPulsing(false), 150);
          }, 800 + Math.random() * 1200);
        }, 500);
      }, delay);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (pulseIntervalRef.current) {
        clearInterval(pulseIntervalRef.current);
      }
    };
  }, [isSpinning, digit, delay]);

  return (
    <span 
      className={`inline-block w-[1ch] text-center transition-all ${
        isAnimating 
          ? 'blur-[2px] scale-110 duration-200' 
          : isPulsing 
            ? 'scale-150 duration-150' 
            : 'scale-100 duration-300'
      }`}
      style={{
        transform: isAnimating ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {currentDigit}
    </span>
  );
}

