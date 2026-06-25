import type { ElementType } from 'react';

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
  return (
    <>
      <div className="hidden sm:block rounded-lg border border-gray-300 bg-white px-8 pb-10 pt-6">
        <div className="relative flex items-center justify-between">
          {/* Background line */}
          <div className="absolute left-0 top-5 h-0.5 w-full bg-gray-200" />
          {/* Active line */}
          <div
            className="absolute left-0 top-5 h-0.5 bg-black transition-all duration-300"
            style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
          />

          {steps.map((item) => {
            const Icon = item.icon;
            const active = currentStep === item.id;
            const done = currentStep > item.id;
            const disabled = item.id > currentStep;

            return (
              <div key={item.id} className="relative z-10 flex flex-col items-center bg-white px-2">
                <button
                  type="button"
                  disabled={disabled || !onStepChange}
                  onClick={() => onStepChange?.(item.id)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                    active
                      ? 'border-black bg-black text-white'
                      : done
                        ? 'border-black bg-white text-black hover:bg-gray-100'
                        : 'border-gray-200 bg-white text-gray-300'
                  } ${(disabled || !onStepChange) ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
                <span
                  className={`absolute -bottom-7 whitespace-nowrap text-xs font-bold ${
                    active ? 'text-black' : done ? 'text-gray-700' : 'text-gray-400'
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
      <div className="sm:hidden rounded-lg border border-gray-300 bg-white p-4 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-900">Step {currentStep} of {steps.length}</span>
        <span className="text-sm font-semibold text-gray-500">{steps[currentStep - 1]?.label}</span>
      </div>
    </>
  );
}
