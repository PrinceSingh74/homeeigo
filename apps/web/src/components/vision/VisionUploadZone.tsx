'use client';

import { useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export interface VisionUploadZoneProps {
  onUpload: (file: File, base64: string) => Promise<void>;
  onStateChange?: (state: UploadState) => void;
  disabled?: boolean;
}

export function VisionUploadZone({ onUpload, onStateChange, disabled = false }: VisionUploadZoneProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size is 8MB (yours: ${(file.size / 1024 / 1024).toFixed(1)}MB)`;
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `Unsupported file type. Allowed: JPEG, PNG, WebP`;
    }
    return null;
  };

  const processFile = async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setState('error');
      onStateChange?.('error');
      return;
    }

    setState('uploading');
    onStateChange?.('uploading');
    setError('');
    setProgress(0);

    try {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      reader.onload = async () => {
        const base64 = reader.result as string;
        try {
          await onUpload(file, base64);
          setState('success');
          onStateChange?.('success');
          setTimeout(() => {
            setState('idle');
            setProgress(0);
          }, 2000);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          setError(message);
          setState('error');
          onStateChange?.('error');
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Processing failed';
      setError(message);
      setState('error');
      onStateChange?.('error');
    }
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer?.files;
    if (files && files[0]) {
      processFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="w-full">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950'
            : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_MIME_TYPES.join(',')}
          onChange={handleFileSelect}
          disabled={disabled || state === 'uploading'}
          className="hidden"
        />

        {state === 'idle' && (
          <div onClick={() => fileInputRef.current?.click()} className="space-y-2">
            <Upload className="mx-auto h-12 w-12 text-gray-400" />
            <div className="text-sm font-medium">Drag and drop your image here</div>
            <div className="text-xs text-gray-500">or click to select</div>
            <div className="text-xs text-gray-400 mt-2">Max 8MB • JPEG, PNG, or WebP</div>
          </div>
        )}

        {state === 'uploading' && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Uploading...</div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-500">{progress}%</div>
          </div>
        )}

        {state === 'success' && (
          <div className="space-y-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="mx-auto h-12 w-12" />
            <div className="text-sm font-medium">Upload successful</div>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-2 text-red-600 dark:text-red-400">
            <AlertCircle className="mx-auto h-12 w-12" />
            <div className="text-sm font-medium">Upload failed</div>
            <div className="text-xs">{error}</div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs underline hover:no-underline mt-2"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
