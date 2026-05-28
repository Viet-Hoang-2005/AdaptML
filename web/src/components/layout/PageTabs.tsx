import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';

type PageTab = {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
};

type PageTabsProps = {
  tabs: PageTab[];
};

export function PageTabs({ tabs }: PageTabsProps) {
  return (
    <nav className="-mb-px w-full overflow-x-auto md:w-auto" aria-label="Page sections">
      <div className="flex min-w-max items-center gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;

          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                [
                  'inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors',
                  isActive
                    ? 'border-black text-gray-950'
                    : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-950',
                ].join(' ')
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{tab.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
