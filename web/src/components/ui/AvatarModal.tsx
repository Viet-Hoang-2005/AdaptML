import { ImageUp, Trash2, X } from 'lucide-react';
import { Button } from './Button';
import type { AvatarRecord } from '../../types/auth';

interface AvatarModalProps {
  open: boolean;
  avatarPreview: string;
  avatarHistory?: AvatarRecord[];
  historyLoading?: boolean;
  selectingAvatarId?: string | null;
  onClose: () => void;
  onRemove?: () => void;
  onChange: () => void;
  onSelectAvatar?: (avatarId: string) => void;
}

export function AvatarModal({
  open,
  avatarPreview,
  avatarHistory = [],
  historyLoading = false,
  selectingAvatarId = null,
  onClose,
  onRemove,
  onChange,
  onSelectAvatar,
}: AvatarModalProps) {
  if (!open) return null;

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
          {avatarPreview ? (
            <div className="space-y-4">
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
                  size="md"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={onRemove}
                  disabled={!onRemove}
                >
                  Remove Avatar
                </Button>
                <Button
                  type="button"
                  size="md"
                  icon={<ImageUp className="h-4 w-4" />}
                  onClick={onChange}
                >
                  Change Avatar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-lg border border-dashed border-gray-300 px-5 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                <ImageUp className="h-6 w-6" />
              </div>
              <div className="space-y-1 pb-1">
                <p className="text-lg font-semibold text-gray-900">Set your avatar</p>
                <p className="text-sm text-gray-500">Choose a new image or select a previous avatar below.</p>
              </div>
              <Button type="button" icon={<ImageUp className="h-4 w-4" />} onClick={onChange}>
                Upload image
              </Button>
            </div>
          )}
          {(historyLoading || avatarHistory.length > 0) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900">Previous avatars</h3>
                {historyLoading && <span className="text-xs font-semibold text-gray-400">Loading...</span>}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {avatarHistory.map((avatar) => (
                  <button
                    key={avatar.id}
                    type="button"
                    onClick={() => onSelectAvatar?.(avatar.id)}
                    disabled={avatar.is_current || selectingAvatarId === avatar.id}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 transition ${
                      avatar.is_current
                        ? 'border-black'
                        : 'border-gray-200 hover:border-gray-500 disabled:opacity-60'
                    }`}
                    aria-label={avatar.is_current ? 'Current avatar' : 'Select previous avatar'}
                    title={avatar.is_current ? 'Current avatar' : 'Use this avatar'}
                  >
                    <img src={avatar.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
