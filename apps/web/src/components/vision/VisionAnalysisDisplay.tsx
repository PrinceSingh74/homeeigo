'use client';

import { AlertCircle, Zap } from 'lucide-react';

interface AnalysisResult {
  status: 'ANALYZING' | 'COMPLETE' | 'FAILED';
  result?: string;
  confidence?: number;
  safetyFlags?: string[];
  provider?: 'GEMINI' | 'FALLBACK';
  mode?: 'REAL' | 'SHADOW';
  error?: string;
}

interface VisionAnalysisDisplayProps {
  analysis: AnalysisResult;
  isLoading?: boolean;
}

export function VisionAnalysisDisplay({ analysis, isLoading }: VisionAnalysisDisplayProps) {
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-900 dark:text-white">Analyzing...</div>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (analysis.status === 'FAILED') {
    return (
      <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex gap-2">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-red-900 dark:text-red-100">Analysis failed</div>
            {analysis.error && (
              <div className="text-sm text-red-800 dark:text-red-200 mt-1">{analysis.error}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (analysis.status !== 'COMPLETE' || !analysis.result) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Provider info */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-sm">
          <div className="space-y-1">
            <div className="font-medium text-gray-900 dark:text-white">
              {analysis.provider === 'GEMINI' ? 'Google Gemini Vision' : 'Fallback Model'}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {analysis.mode === 'SHADOW' ? '🧪 Shadow Mode (No Real Effect)' : '⚡ Real Provider'}
            </div>
          </div>
          {analysis.confidence !== undefined && (
            <div className="text-right">
              <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                {Math.round(analysis.confidence * 100)}%
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Confidence</div>
            </div>
          )}
        </div>
      </div>

      {/* Analysis result */}
      <div className="p-4 space-y-4">
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">Analysis</div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
            {analysis.result}
          </div>
        </div>

        {/* Safety flags */}
        {analysis.safetyFlags && analysis.safetyFlags.length > 0 && (
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Safety Flags
            </div>
            <div className="space-y-1">
              {analysis.safetyFlags.map((flag, idx) => (
                <div key={idx} className="text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 bg-amber-600 dark:bg-amber-400 rounded-full" />
                  {flag}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Advisory notice */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-3 text-xs text-blue-700 dark:text-blue-300">
          <div className="flex gap-2">
            <Zap className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              This analysis is advisory only. Homeeigo does not provide professional services diagnosis. Always consult qualified professionals.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
