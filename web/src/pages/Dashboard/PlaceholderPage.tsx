import type { ReactNode } from 'react';
import { useModelSelection } from './modelSelection';

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: ReactNode;
}

export default function PlaceholderPage({ title, description, icon }: PlaceholderPageProps) {
  const { selectedModel } = useModelSelection();

  return (
    <section className="min-h-105 rounded-lg border border-dashed border-gray-300 bg-white px-8 py-10">
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-black">
          {icon}
        </div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {selectedModel ? selectedModel.name : 'No model selected'}
        </p>
        <h1 className="mb-3 text-2xl font-bold text-gray-900">{title}</h1>
        <p className="max-w-xl text-sm leading-6 text-gray-500">{description}</p>
      </div>
    </section>
  );
}
