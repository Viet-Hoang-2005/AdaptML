import React from 'react';

export interface PageContentProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContent({ children, className = '' }: PageContentProps) {
  return (
    <section className={`flex flex-col flex-1 rounded-lg border border-gray-300 bg-white ${className}`}>
      {children}
    </section>
  );
}
