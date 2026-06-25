import type { ElementType } from 'react';

export interface StepTitleProps {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: ElementType;
}

export function StepTitle({ title, subtitle, description, icon: Icon }: StepTitleProps) {
  const text = subtitle || description;
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        {Icon && <Icon className="w-5 h-5 text-gray-500" />}
        {title}
      </h2>
      {text && <p className="text-sm text-gray-500 mt-1">{text}</p>}
    </div>
  );
}
