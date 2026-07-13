import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageTabs } from './PageTabs';
import React from 'react';

export interface PageHeaderProps {
  title: string;
  backLink?: {
    to: string;
    label: string;
  };
  tabs?: React.ComponentProps<typeof PageTabs>['tabs'];
  children?: React.ReactNode;
}

export function PageHeader({ title, backLink, tabs, children }: PageHeaderProps) {
  return (
    <header className={`flex flex-col gap-4 border-b border-border md:flex-row md:items-end md:justify-between ${!tabs ? 'pb-2' : ''}`}>
      <div className={tabs ? "mb-2" : ""}>
        {backLink && (
          <Link to={backLink.to} className="mb-2 inline-flex min-h-9 items-center gap-2 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-4 w-4" />
            {backLink.label}
          </Link>
        )}
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
      </div>
      
      {tabs && <PageTabs tabs={tabs} />}
      {children && !tabs && <div>{children}</div>}
    </header>
  );
}
