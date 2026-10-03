'use client';

import { X } from 'lucide-react';
import Image from 'next/image';

interface VisionImagePreviewProps {
  imageId: string;
  imageUrl: string;
  fileName?: string;
  fileSize?: number;
  uploadedAt?: Date;
  onDelete?: () => void;
}

export function VisionImagePreview({
  imageId,
  imageUrl,
  fileName,
  fileSize,
  uploadedAt,
  onDelete,
}: VisionImagePreviewProps) {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="relative w-full aspect-video bg-gray-100 dark:bg-gray-900">
        <Image
          src={imageUrl}
          alt={fileName || 'Uploaded image'}
          fill
          className="object-contain"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {fileName && (
              <div className="text-sm font-medium truncate text-gray-900 dark:text-white">
                {fileName}
              </div>
            )}
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              ID: <span className="font-mono">{imageId.slice(0, 8)}...</span>
            </div>
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="flex-shrink-0 p-1 hover:bg-red-50 dark:hover:bg-red-950 rounded transition-colors"
              title="Delete image"
            >
              <X className="h-4 w-4 text-red-600 dark:text-red-400" />
            </button>
          )}
        </div>

        {(fileSize || uploadedAt) && (
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            {fileSize && <div>Size: {formatFileSize(fileSize)}</div>}
            {uploadedAt && <div>Uploaded: {uploadedAt.toLocaleString()}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
