import { useState, useRef, useEffect, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import { Trash2, RotateCcw, Upload, Save, FileArchive } from 'lucide-react';
import { toast } from '../../lib/toast';
import { updateModelRequirements } from '../../lib/api';
import type { ModelProject } from '../../types/models';

export interface TextEditorProps {
  modelProject: ModelProject;
  onDirtyChange?: (isDirty: boolean) => void;
  onContentChange?: (content: string) => void;
  /** Called after requirements are successfully persisted to the server (ModelProject.requirements_text updated). */
  onSaveSuccess?: () => void;
}

export function TextEditor({ modelProject, onDirtyChange, onContentChange, onSaveSuccess }: TextEditorProps) {
  const [content, setContent] = useState<string>(modelProject.requirements_text ?? '');
  const [originalContent, setOriginalContent] = useState<string>(modelProject.requirements_text ?? '');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDirty = content !== originalContent;

  // Notify parent when dirty state changes
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Notify parent of current content on every change (real-time)
  useEffect(() => {
    onContentChange?.(content);
  }, [content, onContentChange]);

  // Reset editor when a different model is selected
  const [prevModelId, setPrevModelId] = useState(modelProject.id);
  if (prevModelId !== modelProject.id) {
    setPrevModelId(modelProject.id);
    const fresh = modelProject.requirements_text ?? '';
    setContent(fresh);
    setOriginalContent(fresh);
  }

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setContent(text);
    } catch {
      toast.error('Failed to read file');
    }
    e.target.value = '';
  }, []);

  const handleDelete = useCallback(() => {
    setContent('');
  }, []);

  const handleReset = useCallback(() => {
    setContent(originalContent);
  }, [originalContent]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateModelRequirements(modelProject.id, content);
      setOriginalContent(content);
      onSaveSuccess?.();
      toast.success('requirements.txt saved successfully.');
    } catch {
      toast.error('Failed to save requirements.txt');
    } finally {
      setSaving(false);
    }
  }, [modelProject.id, content, onSaveSuccess]);

  const isEmpty = content.trim() === '';

  return (
    <div className="flex flex-col h-96 border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
        <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <FileArchive className="w-4 h-4" />
          requirements.txt
          {isDirty && (
            <span className="ml-1 inline-block h-2 w-2 rounded-full bg-yellow-400" title="Unsaved changes" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="file"
            className="hidden"
            accept=".txt"
            ref={fileInputRef}
            onChange={handleUpload}
          />
          <button
            className="p-2 rounded-full hover:bg-gray-200 transition-colors"
            onClick={handleDelete}
            title="Clear content"
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </button>
          <button
            className="p-2 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-40"
            onClick={handleReset}
            disabled={!isDirty}
            title="Reset to last saved"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            className="p-2 rounded-full hover:bg-gray-200 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            title="Upload .txt file"
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            className="p-2 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-40"
            onClick={handleSave}
            disabled={saving || !isDirty}
            title="Save to server"
          >
            {saving ? (
              <div className="w-4 h-4 rounded-full border-2 border-gray-600 border-t-transparent animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isEmpty ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-full flex flex-col items-center justify-center border-0 bg-white hover:bg-gray-50 transition-colors group cursor-pointer"
          >
            <Upload className="w-10 h-10 mb-3 text-gray-300 group-hover:text-blue-400 transition-colors" />
            <p className="text-gray-500 font-medium group-hover:text-blue-600 transition-colors">
              Click to upload requirements.txt
            </p>
            <p className="text-sm text-gray-400 mt-1">
              Or start typing in the editor after clicking a file
            </p>
            <p className="text-xs text-gray-300 mt-3">
              Accepted: .txt
            </p>
          </button>
        ) : (
          <Editor
            height="100%"
            language="plaintext"
            theme="light"
            value={content}
            onChange={(val) => setContent(val ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              occurrencesHighlight: 'off',
              selectionHighlight: false,
            }}
          />
        )}
      </div>
    </div>
  );
}
