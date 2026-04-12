import React from 'react';

interface WavelengthColorBandProps {
  minLabel?: string;
  maxLabel?: string;
  className?: string;
}

export const WavelengthColorBand: React.FC<WavelengthColorBandProps> = ({
  minLabel = '380.0 nm',
  maxLabel = '780.0 nm',
  className = ''
}) => {
  return (
    <div className={`mt-3 ${className}`}>
      <div className="h-3 w-full rounded-md border border-slate-700 bg-gradient-to-r from-violet-600 via-blue-500 via-emerald-400 via-yellow-300 via-orange-400 to-red-600" />
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
};
