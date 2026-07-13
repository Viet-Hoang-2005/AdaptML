import React from 'react';

export interface PageContentProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContent({ children, className = '' }: PageContentProps) {
  return (
    <section className={`flex flex-1 flex-col rounded-xl border border-border bg-surface text-foreground shadow-[var(--shadow-card)] ${className}`}>
      {children}
    </section>
  );
}
