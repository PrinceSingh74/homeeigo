'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { apiRequest } from '@/services/auth/api-client';
import { VisionUploadZone } from '@/components/vision/VisionUploadZone';
import { VisionImagePreview } from '@/components/vision/VisionImagePreview';
import { VisionAnalysisDisplay } from '@/components/vision/VisionAnalysisDisplay';

type PageState = 'upload' | 'preview' | 'analyzing' | 'result';

interface AnalysisData {
  status: 'ANALYZING' | 'COMPLETE' | 'FAILED';
  result?: string;
  confidence?: number;
  safetyFlags?: string[];
  provider?: 'GEMINI' | 'FALLBACK';
  mode?: 'REAL' | 'SHADOW';
  error?: string;
}

export default function VisionPage() {
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');
  const [pageState, setPageState] = useState<PageState>('upload');
  const [currentImageId, setCurrentImageId] = useState<string>('');
  const [currentImageUrl, setCurrentImageUrl] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileSize, setFileSize] = useState<number>(0);
  const [uploadedAt, setUploadedAt] = useState<Date | undefined>();
  const [analysis, setAnalysis] = useState<AnalysisData>({ status: 'ANALYZING' });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!isAuthenticated) {
      setError('Please log in to use Vision');
    }
  }, [isAuthenticated]);

  const handleUpload = async (file: File, base64: string) => {
    try {
      setError('');

      // Extract base64 data (remove data URL prefix)
      const base64Data = base64.split(',')[1];

      // Submit image
      // Authenticated through the shared client (bearer + refresh). This was a bare fetch with no
      // Authorization header against a requireAuth() route, so every upload failed with 401.
      const { data } = await apiRequest<{ success: boolean; data: { id: string } }>('/api/vision/images/submit', {
        method: 'POST',
        auth: true,
        body: {
          bytes: base64Data,
          mimeType: file.type,
          purpose: 'SERVICE_CONTEXT',
        },
      });
      const imageId = data.id;

      setCurrentImageId(imageId);
      setCurrentImageUrl(base64);
      setFileName(file.name);
      setFileSize(file.size);
      setUploadedAt(new Date());
      setPageState('preview');

      // Trigger analysis
      await analyzeImage(imageId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      throw err;
    }
  };

  const analyzeImage = async (imageId: string) => {
    try {
      setPageState('analyzing');
      setIsAnalyzing(true);
      setAnalysis({ status: 'ANALYZING' });

      /**
       * `POST /images/:id/analyze` runs the analysis synchronously and returns the completed
       * result in the same response (see `analyzeImage()` in vision-intelligence.service.ts —
       * it awaits the Gemini call, or the fallback, before the route ever responds). There is no
       * queued/async job to poll for: the previous version of this function discarded this
       * response entirely and polled `GET .../analysis` in a loop checking a `status` field that
       * endpoint's response has never had (it returns the analysis fields directly, with no
       * status wrapper at all) — so `data.status === 'COMPLETE'` could never be true, and every
       * analysis, success or not, ran the full 30-second loop and then reported "timed out",
       * regardless of whether the backend had already succeeded in under a second.
       */
      let body: { success: boolean; data: unknown; error?: string };
      try {
        body = await apiRequest<{ success: boolean; data: unknown; error?: string }>(`/api/vision/images/${imageId}/analyze`, {
          method: 'POST',
          auth: true,
        });
      } catch (err) {
        setAnalysis({
          status: 'FAILED',
          error: err instanceof Error && err.message ? err.message : 'Analysis failed. Please try again.',
        });
        setPageState('result');
        return;
      }

      const result = body.data as {
        observationMode: 'REAL_PROVIDER' | 'FALLBACK';
        provider: string;
        observedCategory: string | null;
        observations: string[];
        confidence: number;
        safetyFlags: string[];
      };

      const summary = [
        result.observedCategory ? `Category: ${result.observedCategory}` : null,
        ...result.observations,
      ]
        .filter(Boolean)
        .join('\n');

      setAnalysis({
        status: 'COMPLETE',
        result: summary || 'No observations returned.',
        confidence: result.confidence,
        safetyFlags: result.safetyFlags,
        provider: result.provider === 'GEMINI' ? 'GEMINI' : 'FALLBACK',
        mode: result.observationMode === 'REAL_PROVIDER' ? 'REAL' : 'SHADOW',
      });
      setPageState('result');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setAnalysis({
        status: 'FAILED',
        error: message,
      });
      setPageState('result');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRetry = async () => {
    if (currentImageId) {
      await analyzeImage(currentImageId);
    }
  };

  const handleReset = () => {
    setPageState('upload');
    setCurrentImageId('');
    setCurrentImageUrl('');
    setFileName('');
    setFileSize(0);
    setUploadedAt(undefined);
    setAnalysis({ status: 'ANALYZING' });
    setError('');
  };

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <h1 className="text-lg font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
            Authentication Required
          </h1>
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            Please log in to use the Vision feature.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Vision Analysis</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Upload photos for AI-assisted analysis. Advisory only—always consult professionals.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {pageState === 'upload' && (
          <VisionUploadZone onUpload={handleUpload} disabled={isAnalyzing} />
        )}

        {(pageState === 'preview' || pageState === 'analyzing' || pageState === 'result') && (
          <VisionImagePreview
            imageId={currentImageId}
            imageUrl={currentImageUrl}
            fileName={fileName}
            fileSize={fileSize}
            uploadedAt={uploadedAt}
            onDelete={handleReset}
          />
        )}

        {(pageState === 'analyzing' || pageState === 'result') && (
          <VisionAnalysisDisplay analysis={analysis} isLoading={isAnalyzing} />
        )}

        {pageState === 'result' && (
          <div className="flex gap-2">
            <button
              onClick={handleRetry}
              disabled={isAnalyzing}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Re-analyze
            </button>
            <button
              onClick={handleReset}
              disabled={isAnalyzing}
              className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-900 dark:text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Upload New
            </button>
          </div>
        )}
      </div>

      {/* Info sections */}
      <div className="max-w-2xl mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white mb-2">How it works</h2>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>• Upload a photo of the service area or issue</li>
            <li>• AI analyzes the image and provides observations</li>
            <li>• Review results and confidence levels</li>
            <li>• Use insights to help with your booking request</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white mb-2">Important notes</h2>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>• Analysis is advisory only</li>
            <li>• Always consult qualified professionals</li>
            <li>• Photos are processed securely and not stored permanently</li>
            <li>• Maximum file size: 8MB (JPEG, PNG, WebP)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
