import React from 'react';
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'secondary' | 'outline' | 'default' };
export const Button: React.FC<Props> = ({ className, variant='default', ...props }) => (
  <button
    className={({
      'default': 'bg-black text-white',
      'secondary': 'bg-gray-100 text-black',
      'outline': 'border bg-white text-black'
    } as any)[variant] + ' rounded-xl px-3 py-2 text-sm hover:opacity-90 ' + (className ?? '')}
    {...props}
  />
);
