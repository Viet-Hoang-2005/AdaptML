import { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { Editor } from '@monaco-editor/react';
import { Download, Save, FolderOpen, Upload, RotateCcw, Trash2, Database, FileCode2, Play } from 'lucide-react';
import { Button } from './Button';
import { CSVEditor } from './CSVEditor';
import { toast } from '../../lib/toast';
import { updateModelAPI } from '../../lib/api';
import type { ModelAPI, ModelAPIFormValues } from '../../types/modelApi';

export interface SourceEditorProps {
  modelApi: ModelAPI;
  fileType: 'source_code_file' | 'reference_data_file';
  title: string;
  icon: React.ReactNode;
  accept: string;
  defaultFilename: string;
  editorType: 'code' | 'csv';
  onDirtyChange?: (isDirty: boolean) => void;
  onSetEntryPoint?: (filename: string) => void;
  currentEntryPoint?: string;
}

const loadZipFromUrl = async (url: string | null | undefined, defaultFilename: string): Promise<JSZip> => {
  const newZip = new JSZip();
  if (!url) return newZip;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const blob = await res.blob();
  
  const urlWithoutQuery = url.split('?')[0];
  
  if (urlWithoutQuery.toLowerCase().endsWith('.zip')) {
    const tempZip = await JSZip.loadAsync(blob);
    const promises: Promise<void>[] = [];
    tempZip.forEach((path, file) => {
      if (!file.dir) {
        promises.push(file.async('blob').then(b => { newZip.file(path, b); }));
      }
    });
    await Promise.all(promises);
  } else {
    const filename = urlWithoutQuery.split('/').pop() || defaultFilename;
    newZip.file(filename, blob);
  }
  return newZip;
};

export function SourceEditor({ 
  modelApi, 
  fileType, 
  title, 
  icon, 
  accept, 
  defaultFilename, 
  editorType,
  onDirtyChange,
  onSetEntryPoint,
  currentEntryPoint
}: SourceEditorProps) {
  const [zip, setZip] = useState<JSZip | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prevPaths, setPrevPaths] = useState(paths);
  if (paths !== prevPaths) {
    setPrevPaths(paths);
    if (selectedPath && !paths.includes(selectedPath)) {
      setSelectedPath(null);
      setFileContent('');
    }
  }

  useEffect(() => {
    if (paths.length > 0 && !selectedPath && zip) {
      const firstPath = paths[0];
      const file = zip.file(firstPath);
      if (file) {
        file.async('string').then(text => {
          setFileContent(text);
          setSelectedPath(firstPath);
        });
      }
    }
  }, [paths, selectedPath, zip]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    let isMounted = true;

    const loadFiles = async () => {
      setLoading(true);
      try {
        const url = modelApi[fileType];
        const newZip = await loadZipFromUrl(url, defaultFilename);
        
        if (!isMounted) return;

        const newPaths: string[] = [];
        newZip.forEach((path, f) => { if (!f.dir) newPaths.push(path); });

        setZip(newZip);
        setPaths(newPaths.sort());

      } catch (err) {
        if (isMounted) {
          console.error(err);
          toast.error(`Failed to load ${title} from S3. CORS might be blocking the request.`);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadFiles();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelApi.id, fileType, defaultFilename, title]);

  const reloadZip = async () => {
    try {
      const url = modelApi[fileType];
      const z = await loadZipFromUrl(url, defaultFilename);
      const p: string[] = [];
      z.forEach((path, f) => { if (!f.dir) p.push(path); });
      setZip(z);
      setPaths(p.sort());
      setIsDirty(false);
      toast.success(`${title} reset to original state.`);
    } catch (err) {
      toast.error(`Failed to reset ${title}: ${err}`);
    }
  };

  const clearZip = () => {
    setZip(new JSZip());
    setPaths([]);
    setIsDirty(true);
    toast.warning(`${title} cleared. Remember to Save Changes.`);
  };

  const handleSave = async () => {
    if (!zip) return;
    setSaving(true);
    try {
      const cleanZip = new JSZip();
      
      const promises: Promise<void>[] = [];
      zip.forEach((path, file) => {
        if (!file.dir) {
           promises.push(file.async('blob').then(b => { cleanZip.file(path, b); }));
        }
      });
      await Promise.all(promises);

      const payload: ModelAPIFormValues = {
        name: modelApi.name,
        description: modelApi.description,
        model_info: modelApi.model_info,
        access_mode: modelApi.access_mode,
      };

      const zipBlob = await cleanZip.generateAsync({ type: 'blob' });
      if (fileType === 'source_code_file') {
        payload.source_code_file = new File([zipBlob], 'source_code.zip', { type: 'application/zip' });
      } else {
        payload.reference_data_file = new File([zipBlob], 'reference_data.zip', { type: 'application/zip' });
      }

      await updateModelAPI(modelApi.id, payload);
      setIsDirty(false);
      toast.success(`${title} saved successfully!`);
    } catch (err) {
      console.error(err);
      toast.error(`Failed to save ${title}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    if (!zip) return;
    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${modelApi.name.replace(/\s+/g, '_')}_${fileType.replace('_file', '')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate download zip.');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const freshZip = new JSZip();

      if (file.name.toLowerCase().endsWith('.zip')) {
        const newZip = await JSZip.loadAsync(file);
        const promises: Promise<void>[] = [];
        newZip.forEach((path, f) => {
          if (!f.dir) {
            promises.push(f.async('blob').then(b => { freshZip.file(path, b); }));
          }
        });
        await Promise.all(promises);
      } else {
        freshZip.file(file.name, file);
      }

      const newPaths: string[] = [];
      freshZip.forEach((path, f) => {
        if (!f.dir) newPaths.push(path);
      });
      setZip(freshZip);
      setPaths(newPaths.sort());
      setIsDirty(true);
      toast.success(`${file.name} uploaded. Remember to Save Changes.`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to upload file');
    }
    e.target.value = '';
  };

  const handleSelectPath = async (path: string) => {
    if (!zip) return;
    setSelectedPath(path);
    const file = zip.file(path);
    if (file) {
      const text = await file.async('string');
      setFileContent(text);
    } else {
      setFileContent('');
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (!zip) return;
    const val = value || '';
    setFileContent(val);
    if (selectedPath) {
      zip.file(selectedPath, val);
      setIsDirty(true);
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

  if (loading || !zip) {
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
            {onSetEntryPoint && selectedPath?.endsWith('.py') && (
              <button 
                className={`px-3 py-1 text-xs rounded font-medium mr-2 flex items-center gap-1 transition-colors ${
                  currentEntryPoint === selectedPath 
                    ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700' 
                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                }`}
                onClick={() => onSetEntryPoint(selectedPath)}
                title="Set this file as the main entry point for the training job"
              >
                <Play className="w-3 h-3" />
                {currentEntryPoint === selectedPath ? 'Main' : 'Set as Main'}
              </button>
            )}
            <input type="file" className="hidden" accept={accept} ref={fileInputRef} onChange={handleUpload} />

            <button className="p-2 rounded-full hover:bg-gray-200" onClick={clearZip} title="Clear entire directory">
              <Trash2 className="w-4 h-4 text-red-500 hover:text-red-600" />
            </button>
            <button 
              className="p-2 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-40" 
              onClick={reloadZip} 
              disabled={!isDirty}
              title="Reset to last saved"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button className="p-2 rounded-full hover:bg-gray-200" onClick={() => fileInputRef.current?.click()} title="Upload directory">
              <Upload className="w-4 h-4" />
            </button>
            <button 
              className="p-2 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-40" 
              onClick={handleSave} 
              disabled={saving || !isDirty} 
              title="Save Changes"
            >
              {saving ? <div className="w-4 h-4 rounded-full border-2 border-gray-600 border-t-transparent animate-spin" /> : <Save className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="w-1/4 flex items-center justify-end p-3 border-l border-gray-200 bg-gray-50">
          <Button variant="secondary" size="sm" icon={<Download className="w-4 h-4" />} onClick={handleDownload}>
            Download ZIP
          </Button>
        </div>
      </div>
      
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 bg-white flex flex-col min-w-0">
          {!selectedPath ? (
            <div className="flex-1 flex flex-col p-6 bg-white">
              {paths.length === 0 ? (
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
                  <p>Select a file from the right panel to view or edit</p>
                </div>
              )}
            </div>
          ) : editorType === 'csv' || isCsv ? (
            <CSVEditor initialCsvText={fileContent} onChange={handleEditorChange} />
          ) : (
            <Editor
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

        <div className="w-1/4 border-l border-gray-200 bg-gray-50 overflow-y-auto p-2">
          {paths.length === 0 ? (
            <p className="text-sm text-gray-500 text-center mt-10">No files found.</p>
          ) : (
            <ul className="space-y-1">
              {paths.map(path => {
                const isSelected = selectedPath === path;
                const parts = path.split('/');
                const filename = parts.pop();
                const folderPath = parts.join('/');
                return (
                  <li key={path}>
                    <button
                      onClick={() => handleSelectPath(path)}
                      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-sm truncate transition-colors ${
                        isSelected ? 'bg-blue-100 text-blue-900 font-medium' : 'text-gray-700 hover:bg-gray-200'
                      }`}
                      title={path}
                    >
                      {path.endsWith('.csv') ? (
                        <Database className="w-4 h-4 text-green-600 shrink-0" />
                      ) : (
                        <FileCode2 className="w-4 h-4 text-blue-600 shrink-0" />
                      )}
                      <span className="truncate flex-1">
                        <span className="text-gray-400 text-xs">{folderPath ? `${folderPath}/` : ''}</span>
                        {filename}
                      </span>
                      {currentEntryPoint === path && (
                        <Play className="w-3 h-3 text-blue-600 shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
