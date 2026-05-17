import type { InputHTMLAttributes, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

export function Input({ label, error, icon, className = '', id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {icon}
          </span>
        )}
        <input
          id={id}
          className={`
            w-full h-14 rounded-2xl border bg-white text-sm text-gray-800 placeholder-gray-400
            hover:border-black transition-colors duration-200 outline-none
            ${icon ? 'pl-10 pr-4' : 'px-4'}
            ${error
              ? 'border-red-400 focus:border-red-500'
              : 'border-gray-300 focus:border-black'
            }
            disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
            ${className}
          `}
          {...props}
        />
      </div>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

interface InputPasswordProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

export function InputPassword({ label, error, icon, className = '', id, ...props }: InputPasswordProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {icon}
          </span>
        )}
        <input
          id={id}
          type="password"
          className={`
            w-full h-14 rounded-2xl border bg-white text-sm text-gray-800 placeholder-gray-400
            hover:border-black transition-colors duration-200 outline-none
            ${icon ? 'pl-10 pr-4' : 'px-4'}
            ${error
              ? 'border-red-400 focus:border-red-500'
              : 'border-gray-300 focus:border-black'
            }
            disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
            ${className}
          `}
          {...props}
        />
      </div>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
