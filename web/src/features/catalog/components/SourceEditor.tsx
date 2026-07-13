import { useState, useEffect, useRef, useMemo } from 'react';
import { LazyCodeEditor } from '@/shared/ui/LazyCodeEditor';
import { Save, FolderOpen, Upload, Play, FilePlus, FolderPlus, Trash2 } from 'lucide-react';
import { CSVEditor } from '@/shared/ui/CSVEditor';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { Button } from '@/shared/ui/Button';
import { toast } from '@/shared/ui/toastStore';
import { 
  listSourceCodeFiles, 
  uploadSourceCodeFile, 
  deleteSourceCodeFile,
  listReferenceFiles, 
  uploadReferenceFile,
  deleteReferenceFile,
  type WorkspaceFile as S3File
} from '@/features/catalog/api/catalogApi';
import {
  SourceTree,
} from './SourceTree';
import {
  buildSourceTree,
  type CreatingFileState,
} from './sourceTreeModel';

export interface SourceEditorProps {
  modelId: string;
  fileType: 'code_file' | 'data_file';
  title: string;
  icon: React.ReactNode;
  accept: string;
  editorType: 'code' | 'csv';
  onDirtyChange?: (isDirty: boolean) => void;
  onSetEntryPoint?: (filename: string) => void;
  currentEntryPoint?: string;
  setAsMainLabel?: string;
  entryPointExtension?: string;
}

export function SourceEditor({ 
  modelId, 
  fileType,
  title, 
  icon, 
  accept,  
  editorType,
  onDirtyChange,
  onSetEntryPoint,
  currentEntryPoint,
  setAsMainLabel,
  entryPointExtension = '.py',
}: SourceEditorProps) {
  const [files, setFiles] = useState<S3File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [unsavedContents, setUnsavedContents] = useState<Record<string, string>>({});
  const isDirty = Object.keys(unsavedContents).length > 0;

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [creatingFile, setCreatingFile] = useState<CreatingFileState | null>(null);
  const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null);

  const treeNodes = useMemo(() => buildSourceTree(files), [files]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleSelectPath = async (path: string, currentFiles = files) => {
    setSelectedPath(path);
    // Expand parent folders
    const parts = path.split('/');
    parts.pop(); // remove filename
    if (parts.length > 0) {
      setExpandedFolders(prev => {
        const next = new Set(prev);
        let curr = '';
        for (const p of parts) {
          curr += (curr ? '/' : '') + p;
          next.add(curr);
        }
        return next;
      });
    }

    const isFolder = currentFiles.some(f => f.relative_path.startsWith(path + '/'));
    if (isFolder) {
      setFileContent('');
      return;
    }

    if (unsavedContents[path] !== undefined) {
      setFileContent(unsavedContents[path]);
      return;
    }

    const fileMeta = currentFiles.find(f => f.relative_path === path);
    if (fileMeta) {
      try {
        const res = await fetch(fileMeta.download_url);
        if (!res.ok) throw new Error('Download failed');
        const text = await res.text();
        setFileContent(text);
      } catch (err) {
        console.error(err);
        toast.error(`Failed to load content for ${path}`);
        setFileContent('');
      }
    } else {
      setFileContent('');
    }
  };

  const fetchFiles = async () => {
    try {
      let data: S3File[] = [];
      if (fileType === 'code_file') {
        data = await listSourceCodeFiles(modelId);
      } else {
        data = await listReferenceFiles(modelId);
      }
      data.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
      setFiles(data);
      
      if (data.length > 0 && !selectedPath) {
        // Auto-select first real file
        const firstFile = data.find(f => !f.relative_path.endsWith('.keep'));
        if (firstFile) handleSelectPath(firstFile.relative_path, data);
      } else if (selectedPath && !data.find(f => f.relative_path === selectedPath) && !data.find(f => f.relative_path.startsWith(selectedPath + '/'))) {
        setSelectedPath(null);
        setFileContent('');
      }
    } catch (err) {
      console.error(err);
      toast.error(`Failed to load ${title} list.`);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setLoading(true);
      await fetchFiles();
      if (isMounted) setLoading(false);
    };
    loadData();
    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, fileType]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleEditorChange = (value: string | undefined) => {
    const val = value || '';
    setFileContent(val);
    if (selectedPath) {
      setUnsavedContents(prev => ({ ...prev, [selectedPath]: val }));
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const promises = Object.entries(unsavedContents).map(async ([path, content]) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const file = new File([blob], path.split('/').pop() || 'file.txt');
        
        if (fileType === 'code_file') {
          await uploadSourceCodeFile(modelId, file, path);
        } else {
          await uploadReferenceFile(modelId, file, path);
        }
      });
      
      await Promise.all(promises);
      setUnsavedContents({});
      toast.success(`${title} saved successfully!`);
      await fetchFiles();
    } catch (err) {
      console.error(err);
      toast.error(`Failed to save ${title}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;
    
    const filesArray = Array.from(uploadedFiles);
    try {
      setSaving(true);
      let prefix = '';
      if (selectedPath) {
        const isFolder = files.some(f => f.relative_path.startsWith(selectedPath + '/'));
        if (isFolder) {
          prefix = selectedPath + '/';
        } else {
          const parts = selectedPath.split('/');
          parts.pop();
          if (parts.length > 0) prefix = parts.join('/') + '/';
        }
      }

      const promises = filesArray.map(async (file) => {
        const path = prefix + file.name; 
        if (fileType === 'code_file') {
          await uploadSourceCodeFile(modelId, file, path);
        } else {
          await uploadReferenceFile(modelId, file, path);
        }
      });
      
      await Promise.all(promises);
      toast.success(`${filesArray.length} file(s) uploaded successfully!`);
      await fetchFiles();
    } catch (err) {
      console.error(err);
      toast.error('Failed to upload files');
    } finally {
      setSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startCreateFile = () => {
    let parentPath = '';
    if (selectedPath) {
      const isFolder = files.some(f => f.relative_path.startsWith(selectedPath + '/'));
      if (isFolder) {
        parentPath = selectedPath;
      } else {
        const parts = selectedPath.split('/');
        parts.pop();
        if (parts.length > 0) parentPath = parts.join('/');
      }
    }
    setCreatingFile({ type: 'file', parentPath });
    if (parentPath) {
      setExpandedFolders(prev => new Set(prev).add(parentPath));
    }
  };

  const startCreateFolder = () => {
    let parentPath = '';
    if (selectedPath) {
      const isFolder = files.some(f => f.relative_path.startsWith(selectedPath + '/'));
      if (isFolder) {
        parentPath = selectedPath;
      } else {
        const parts = selectedPath.split('/');
        parts.pop();
        if (parts.length > 0) parentPath = parts.join('/');
      }
    }
    setCreatingFile({ type: 'folder', parentPath });
    if (parentPath) {
      setExpandedFolders(prev => new Set(prev).add(parentPath));
    }
  };

  const finishCreate = async (name: string) => {
    const creating = creatingFile;
    setCreatingFile(null);
    if (!name || !creating) return;
    
    const { type, parentPath } = creating;
    const path = parentPath ? `${parentPath}/${name}` : name;
    
    if (type === 'file') {
      setUnsavedContents(prev => ({ ...prev, [path]: '' }));
      const virtualFile: S3File = {
        key: path,
        relative_path: path,
        size_bytes: 0,
        updated_at: new Date().toISOString(),
        download_url: '',
      };
      setFiles(prev => [...prev.filter(f => f.relative_path !== path), virtualFile]);
      handleSelectPath(path, [...files, virtualFile]);
    } else {
      const keepPath = `${path}/.keep`;
      try {
        setSaving(true);
        const emptyFile = new File([new Blob([''])], '.keep');
        if (fileType === 'code_file') {
          await uploadSourceCodeFile(modelId, emptyFile, keepPath);
        } else {
          await uploadReferenceFile(modelId, emptyFile, keepPath);
        }
        toast.success(`Folder ${name} created!`);
        await fetchFiles();
        setExpandedFolders(prev => new Set(prev).add(path));
      } catch (err) {
        console.error(err);
        toast.error('Failed to create folder');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDelete = () => {
    if (!selectedPath) return;
    setDeleteConfirmPath(selectedPath);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmPath) return;
    
    const isFolder = files.some(f => f.relative_path.startsWith(deleteConfirmPath + '/'));

    try {
      setSaving(true);
      const pathToDelete = isFolder ? `${deleteConfirmPath}/` : deleteConfirmPath;
      if (fileType === 'code_file') {
        await deleteSourceCodeFile(modelId, pathToDelete);
      } else {
        await deleteReferenceFile(modelId, pathToDelete);
      }
      
      if (unsavedContents[deleteConfirmPath]) {
        setUnsavedContents(prev => {
          const next = { ...prev };
          delete next[deleteConfirmPath];
          return next;
        });
      }

      toast.success(`${isFolder ? 'Folder' : 'File'} deleted!`);
      if (selectedPath === deleteConfirmPath || selectedPath?.startsWith(deleteConfirmPath + '/')) {
        setSelectedPath(null);
        setFileContent('');
      }
      await fetchFiles();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete item');
    } finally {
      setSaving(false);
      setDeleteConfirmPath(null);
    }
  };

  const getLanguage = (path: string) => {
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.js')) return 'javascript';
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.md')) return 'markdown';
    if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
    if (path.endsWith('.sh')) return 'shell';
    return 'plaintext';
  };

  const isCsv = selectedPath?.endsWith('.csv');
  const isSelectedFolder = selectedPath ? files.some(f => f.relative_path.startsWith(selectedPath + '/')) : false;

  if (loading) {
    return (
      <div className="flex h-125 border border-gray-300 rounded-lg bg-white mb-6 items-center justify-center shadow-sm">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-black border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-125 border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm">
      <div className="flex border-b border-gray-200 bg-gray-50">
        <div className="flex-1 flex items-center justify-between p-3">
          <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            {icon}
            {title}
            {isDirty && (
              <span className="ml-1 inline-block h-2 w-2 rounded-full bg-yellow-400" title="Unsaved changes" />
            )}
          </div>
          <div className="flex items-center gap-1">
            {onSetEntryPoint && selectedPath?.endsWith(entryPointExtension) && (
              <button 
                className={`px-3 py-2 text-xs rounded-xl font-medium mr-2 flex items-center gap-1 transition-colors ${
                  currentEntryPoint === selectedPath 
                    ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700' 
                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                }`}
                onClick={() => onSetEntryPoint(selectedPath)}
                title={setAsMainLabel ?? "Set this file as the main entry point"}
              >
                <Play className="w-3 h-3" />
                {currentEntryPoint === selectedPath ? 'Selected' : (setAsMainLabel ?? 'Set as Main')}
              </button>
            )}
            
            <Button 
              variant="primary"
              size="sm"
              onClick={handleSave} 
              disabled={saving || !isDirty} 
              loading={saving}
              title="Save Changes"
            >
              <Save className="w-4 h-4 mr-1.5" />
              Save
            </Button>
          </div>
        </div>
      </div>
      
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 bg-white flex flex-col min-w-0">
          {!selectedPath || isSelectedFolder ? (
            <div className="flex-1 flex flex-col p-6 bg-white">
              {files.length === 0 ? (
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  className="flex-1 w-full flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg hover:bg-gray-50 hover:border-blue-500 transition-colors group cursor-pointer"
                >
                  <Upload className="w-12 h-12 mb-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  <p className="text-gray-600 font-medium text-lg group-hover:text-blue-600 transition-colors">Click to upload file</p>
                  <p className="text-sm text-gray-400 mt-2">Support: {accept}</p>
                </button>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                  <FolderOpen className="w-12 h-12 mb-4 text-gray-300" />
                  <p>Select a file from the tree to view or edit</p>
                </div>
              )}
            </div>
          ) : editorType === 'csv' || isCsv ? (
            <CSVEditor initialCsvText={fileContent} onChange={handleEditorChange} />
          ) : (
              <LazyCodeEditor
              height="100%"
              language={getLanguage(selectedPath)}
              theme="light"
              value={fileContent}
              onChange={handleEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
              }}
            />
          )}
        </div>

        <div className="w-75 border-l border-gray-200 bg-gray-50 flex flex-col shrink-0">
          <div className="flex items-center justify-between p-2 border-b border-gray-200 text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider pl-2 text-gray-600">Explorer</span>
            <div className="flex items-center gap-1">
              <button onClick={startCreateFile} title="New File" className="p-1 hover:bg-gray-200 rounded text-gray-700">
                <FilePlus className="w-4 h-4" />
              </button>
              <button onClick={startCreateFolder} title="New Folder" className="p-1 hover:bg-gray-200 rounded text-gray-700">
                <FolderPlus className="w-4 h-4" />
              </button>
              <button onClick={() => fileInputRef.current?.click()} title="Upload Files" className="p-1 hover:bg-gray-200 rounded text-gray-700">
                <Upload className="w-4 h-4" />
              </button>
              <button onClick={handleDelete} title="Delete Selected" disabled={!selectedPath} className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 text-red-500 hover:text-red-700">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <input type="file" multiple className="hidden" accept={accept} ref={fileInputRef} onChange={handleUpload} />

          <div className="flex-1 overflow-y-auto py-2 pr-2">
            {files.length === 0 && !creatingFile ? (
              <div className="text-sm text-gray-500 text-center py-8">
                No files found.
              </div>
            ) : (
              <SourceTree
                nodes={treeNodes} 
                selectedPath={selectedPath} 
                onSelect={handleSelectPath} 
                unsavedContents={unsavedContents}
                currentEntryPoint={currentEntryPoint}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                creatingFile={creatingFile}
                onFinishCreating={finishCreate}
                currentParentPath=""
              />
            )}
          </div>
        </div>
      </div>
      
      <ConfirmModal
        open={!!deleteConfirmPath}
        title="Delete Item"
        description={
          deleteConfirmPath ? (
            <p>
              Are you sure you want to delete {files.some(f => f.relative_path.startsWith(deleteConfirmPath + '/')) ? 'folder' : 'file'} <span className="font-semibold text-gray-900">"{deleteConfirmPath}"</span>?
              <br />
              This action cannot be undone.
            </p>
          ) : null
        }
        tone="danger"
        confirmText="Delete"
        loading={saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmPath(null)}
      />
    </div>
  );
}
