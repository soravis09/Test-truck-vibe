import React from 'react';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={'w-full rounded-xl border px-3 py-2 text-sm ' + (className ?? '')} {...props} />
  )
);
Input.displayName = 'Input';
