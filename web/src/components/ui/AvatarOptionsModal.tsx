import { ImageUp, Trash2, X } from 'lucide-react';
import { Button } from './Button';

interface AvatarOptionsModalProps {
  open: boolean;
  avatarPreview: string;
  onClose: () => void;
  onRemove: () => void;
  onChange: () => void;
}

export function AvatarOptionsModal({
  open,
  avatarPreview,
  onClose,
  onRemove,
  onChange,
}: AvatarOptionsModalProps) {
  if (!open || !avatarPreview) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-300 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-2">
          <h2 className="text-xl font-bold text-gray-900">Avatar</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-black"
            aria-label="Close avatar options modal"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="space-y-6 px-6 py-6">
          <div className="flex justify-center">
            <img
              src={avatarPreview}
              alt="Current avatar"
              className="h-40 w-40 rounded-full object-cover"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant="danger"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={onRemove}
            >
              Remove Avatar
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon={<ImageUp className="h-4 w-4" />}
              onClick={onChange}
            >
              Change Avatar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
