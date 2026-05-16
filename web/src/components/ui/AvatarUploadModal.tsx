import { ImageUp, X } from 'lucide-react';
import { Button } from './Button';

interface AvatarUploadModalProps {
  open: boolean;
  onClose: () => void;
  onUpload: () => void;
}

export function AvatarUploadModal({ open, onClose, onUpload }: AvatarUploadModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-xl font-bold text-gray-900">Upload avatar</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-black"
            aria-label="Close upload avatar modal"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="space-y-6 px-6 py-6">
          <div className="rounded-lg border border-dashed border-gray-300 px-5 py-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <ImageUp className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Choose an image from your computer</h3>
            <p className="mt-1 text-sm text-gray-500">JPG, PNG, or WebP. Maximum file size is 5MB.</p>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" icon={<ImageUp className="h-4 w-4" />} onClick={onUpload}>
              Upload image
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
