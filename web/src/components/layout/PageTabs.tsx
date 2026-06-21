import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';

export type PageTab = {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  to?: string;
  onClick?: () => void;
  isActive?: boolean;
};

type PageTabsProps = {
  tabs: PageTab[];
};

export function PageTabs({ tabs }: PageTabsProps) {
  return (
    <nav className="-mb-px w-full overflow-x-auto md:w-auto" aria-label="Page sections">
      <div className="flex min-w-max items-center gap-2">
        {tabs.map((tab, idx) => {
          const Icon = tab.icon;
          const key = tab.to || tab.label + idx;

          if (tab.to) {
            return (
              <NavLink
                key={key}
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
                {Icon && <Icon className="h-4 w-4 shrink-0" />}
                <span className="whitespace-nowrap">{tab.label}</span>
              </NavLink>
            );
          }

          return (
            <button
              key={key}
              type="button"
              onClick={tab.onClick}
              className={[
                'inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors',
                tab.isActive
                  ? 'border-black text-gray-950'
                  : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-950',
              ].join(' ')}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
