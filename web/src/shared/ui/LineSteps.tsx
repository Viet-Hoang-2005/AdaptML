import type { ElementType } from 'react';
import { useTranslation } from 'react-i18next';

export interface StepItem {
  id: number;
  label: string;
  icon: ElementType;
}

export interface LineStepsProps {
  steps: StepItem[];
  currentStep: number;
  onStepChange?: (step: number) => void;
}

export function LineSteps({ steps, currentStep, onStepChange }: LineStepsProps) {
  const { t } = useTranslation('common');
  return (
    <>
      <div className="hidden sm:block rounded-lg border border-border bg-surface px-8 pb-10 pt-6">
        <div className="relative flex items-center justify-between">
          {/* Background line */}
          <div className="absolute left-0 top-5 h-0.5 w-full bg-muted" />
          {/* Active line */}
          <div
            className="absolute left-0 top-5 h-0.5 bg-primary transition-all duration-300"
            style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
          />

          {steps.map((item) => {
            const Icon = item.icon;
            const active = currentStep === item.id;
            const done = currentStep > item.id;
            const disabled = item.id > currentStep;

            return (
              <div key={item.id} className="relative z-10 flex flex-col items-center bg-surface px-2">
                <button
                  type="button"
                  disabled={disabled || !onStepChange}
                  onClick={() => onStepChange?.(item.id)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : done
                        ? 'border-primary bg-surface text-foreground hover:bg-muted'
                        : 'border-border bg-surface text-muted-foreground'
                  } ${(disabled || !onStepChange) ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
                <span
                  className={`absolute -bottom-7 whitespace-nowrap text-xs font-bold ${
                    active ? 'text-foreground' : done ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fallback stepper cho mobile */}
      <div className="sm:hidden rounded-lg border border-border bg-surface p-4 flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">{t('steps.progress', { current: currentStep, total: steps.length })}</span>
        <span className="text-sm font-semibold text-muted-foreground">{steps[currentStep - 1]?.label}</span>
      </div>
    </>
  );
}
