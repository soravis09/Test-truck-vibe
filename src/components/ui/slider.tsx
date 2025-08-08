import React from 'react';
type Props = { value: number[]; min?: number; max?: number; step?: number; onValueChange: (v: number[]) => void };
export const Slider: React.FC<Props> = ({ value, min=0, max=100, step=1, onValueChange }) => (
  <input
    type="range"
    min={min}
    max={max}
    step={step}
    value={value[0] ?? 0}
    onChange={(e) => onValueChange([Number(e.target.value)])}
    className="w-full"
  />
);
