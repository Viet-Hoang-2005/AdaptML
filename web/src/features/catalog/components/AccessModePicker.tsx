import type { ModelAccessMode } from '@/features/catalog/types';
import { Picker } from '@/shared/ui/Picker';

export function AccessModePicker({
  value,
  onChange,
}: {
  value: ModelAccessMode;
  onChange: (value: ModelAccessMode) => void;
}) {
  return (
    <Picker
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'private',
          title: 'Private API',
          description: 'Requires JWT or API key.',
        },
        {
          value: 'public',
          title: 'Public API',
          description: 'Allows public prediction requests.',
        },
      ]}
    />
  );
}
