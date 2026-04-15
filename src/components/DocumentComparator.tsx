'use client';

import { useState, useCallback, useEffect } from 'react';
import { analyzeWithAI, extractSchoolName, type ComparisonResult } from '@/lib/aiAnalysis';
import ApiKeyInput from './ApiKeyInput';

export default function DocumentComparator() {
  const [apiKey, setApiKey] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [aiResult, setAiResult] = useState<ComparisonResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
    }
  }, []);

  const handleApiKeySet = useCallback((key: string) => {
    setApiKey(key);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    if (selectedFile.type !== 'application/pdf') {
      setError('PDF 파일만 업로드 가능합니다.');
      setFile(null);
      return;
    }
    setError(null);
    setFile(selectedFile);
    setAiResult(null);
  }, []);

  const extractTextFromPdf = async (file: File): Promise<string> => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: unknown) => ('str' in (item as Record<string, unknown>) ? (item as { str: string }).str : ''))
        .join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  };

  const handleAIAnalyze = useCallback(async () => {
    if (!file || !apiKey) return;

    setIsAnalyzing(true);
    setError(null);
    setAiProgress(0);
    setAiResult(null);

    try {
      const fullText = await extractTextFromPdf(file);
      const schoolName = extractSchoolName(fullText);

      const result = await analyzeWithAI(apiKey, fullText, (progress) => {
        setAiProgress(progress);
      });

      if (schoolName) {
        result.schoolName = schoolName;
      }

      setAiResult(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      if (message.includes('API_KEY')) {
        setError('유효하지 않은 API 키입니다. 다시 확인해주세요.');
      } else if (message.includes('quota') || message.includes('limit')) {
        setError('API 사용량이 초과되었습니다. 나중에 다시 시도해주세요.');
      } else {
        setError(`AI 분석 중 오류가 발생했습니다: ${message}`);
      }
    } finally {
      setIsAnalyzing(false);
      setAiProgress(0);
    }
  }, [file, apiKey]);

  return (
    <div className="space-y-6">
      {!apiKey && (
        <ApiKeyInput onApiKeySet={handleApiKeySet} />
      )}

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-800">
            학업성적관리규정 AI 분석
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            기준: 2025 경기도 초등학교 학업성적관리규정 예시안
          </p>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-purple-400 transition-colors">
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="hidden"
            id="compare-upload"
          />
          <label htmlFor="compare-upload" className="cursor-pointer">
            <div className="text-purple-600 mb-2">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-600">
              {file ? file.name : '분석할 학교 학업성적관리규정 PDF를 선택하세요'}
            </p>
          </label>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {file && (
          <button
            onClick={handleAIAnalyze}
            disabled={isAnalyzing || !apiKey}
            className="mt-4 w-full py-3 px-6 rounded-lg font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white disabled:bg-gray-400"
          >
            {isAnalyzing
              ? `AI 분석 중... ${aiProgress}%`
              : apiKey
                ? 'AI 분석 시작'
                : 'API 키 설정 필요'}
          </button>
        )}
      </div>

      {aiResult && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold">AI 분석 결과</h3>
            <div className="text-xs text-gray-500">
              분석 완료: {new Date(aiResult.analyzedAt).toLocaleString('ko-KR')}
            </div>
          </div>

          {aiResult.schoolName && (
            <div className="mb-6 p-4 bg-purple-50 rounded-lg">
              <h4 className="font-medium text-purple-800">{aiResult.schoolName}</h4>
              <p className="text-sm text-purple-600">학업성적관리규정 AI 분석 결과</p>
            </div>
          )}

          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-700 mb-2">종합 요약</h4>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-gray-700 whitespace-pre-wrap">{aiResult.summary}</p>
            </div>
          </div>

          {aiResult.recommendations.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-700 mb-2">추천 사항</h4>
              <ul className="space-y-2">
                {aiResult.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-purple-600 mt-1">•</span>
                    <span className="text-gray-700">{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">AI 분석 상세 내용</h4>
            <div className="bg-gray-50 rounded-lg p-4">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap max-h-96 overflow-auto">
                {aiResult.summary}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}