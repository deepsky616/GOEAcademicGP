'use client';

import { useState, useCallback, useEffect } from 'react';
import { analyzeWithAI, extractSchoolName, type ComparisonResult } from '@/lib/aiAnalysis';
import ApiKeyInput from './ApiKeyInput';

interface ErrorItem {
  id: number;
  standard: string;
  errorContent: string;
  feedback: string;
}

function parseAIResponseToErrors(summary: string): ErrorItem[] {
  const errors: ErrorItem[] = [];
  let currentError: Partial<ErrorItem> = {};

  const lines = summary.split('\n');
  let lineNum = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.match(/^#{1,3}\s/) || trimmed.match(/^###?\s*\d/)) {
      if (currentError.id && currentError.errorContent) {
        errors.push(currentError as ErrorItem);
        currentError = {};
      }
      continue;
    }

    const numMatch = trimmed.match(/^(제?\d+조[^:\n]*|[가-힣]+\d*[):\s*])/);
    if (numMatch) {
      if (currentError.id && currentError.errorContent) {
        errors.push(currentError as ErrorItem);
      }
      lineNum++;
      currentError = {
        id: lineNum,
        standard: numMatch[1].replace(/[):\s]*$/, '').trim(),
        errorContent: '',
        feedback: '',
      };
      const rest = trimmed.slice(numMatch[0].length).trim();
      if (rest) {
        if (rest.includes('삭제') || rest.includes('제거') || rest.includes('없음')) {
          currentError.errorContent = rest;
          currentError.feedback = '이 조항은 예시안에 없거나 삭제되어야 합니다.';
        } else if (rest.includes('추가') || rest.includes('필요')) {
          currentError.errorContent = '';
          currentError.feedback = rest;
        } else {
          currentError.errorContent = rest;
        }
      }
    } else if (currentError.id) {
      if (currentError.errorContent && !currentError.feedback) {
        currentError.feedback = trimmed.replace(/^[-\•\d)\s]+/, '');
      } else if (!currentError.errorContent && trimmed) {
        currentError.errorContent = (currentError.errorContent || '') + ' ' + trimmed;
      }
    }
  }

  if (currentError.id && currentError.errorContent) {
    errors.push(currentError as ErrorItem);
  }

  if (errors.length === 0) {
    const bulletMatches = summary.matchAll(/^[-\•]\s*(.+)$/gm);
    for (const match of bulletMatches) {
      lineNum++;
      errors.push({
        id: lineNum,
        standard: '학업성적관리규정',
        errorContent: match[1],
        feedback: '',
      });
    }
  }

  return errors;
}

export default function DocumentComparator() {
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('gemini-2.0-flash');
  const [showSettings, setShowSettings] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [aiResult, setAiResult] = useState<ComparisonResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<ErrorItem[]>([]);
  const [deletedItems, setDeletedItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    const savedModel = localStorage.getItem('gemini_model') || 'gemini-2.0-flash';

    if (savedKey) {
      setApiKey(savedKey);
      setModel(savedModel);
      setShowSettings(false);
    } else {
      setShowSettings(true);
    }
  }, []);

  const handleApiKeySet = useCallback((key: string) => {
    setApiKey(key);
    if (key) {
      setShowSettings(false);
    }
  }, []);

  const handleModelChange = useCallback((newModel: string) => {
    setModel(newModel);
    localStorage.setItem('gemini_model', newModel);
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
    setErrorItems([]);
    setDeletedItems(new Set());
  }, []);

  const extractTextFromPdf = async (file: File): Promise<string> => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs`;

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

  const handleAnalyze = useCallback(async () => {
    if (!file || !apiKey) return;

    setIsAnalyzing(true);
    setError(null);
    setAiProgress(0);
    setAiResult(null);
    setErrorItems([]);
    setDeletedItems(new Set());

    try {
      const fullText = await extractTextFromPdf(file);
      const schoolName = extractSchoolName(fullText);

      const result = await analyzeWithAI(apiKey, fullText, model, (progress) => {
        setAiProgress(progress);
      });

      if (schoolName) {
        result.schoolName = schoolName;
      }
      result.model = model;

      setAiResult(result);

      const parsedErrors = parseAIResponseToErrors(result.summary);
      setErrorItems(parsedErrors);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      if (message.includes('API_KEY') || message.includes('key')) {
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
  }, [file, apiKey, model]);

  const handleDeleteItem = useCallback((id: number) => {
    setDeletedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const handleReset = useCallback(() => {
    setFile(null);
    setAiResult(null);
    setErrorItems([]);
    setDeletedItems(new Set());
    setError(null);
    setAiProgress(0);
  }, []);

  const handleCopyAll = useCallback(() => {
    const visibleItems = errorItems.filter(item => !deletedItems.has(item.id));
    const text = visibleItems.map(item =>
      `[${item.standard}]\n오류: ${item.errorContent}\n피드백: ${item.feedback}\n`
    ).join('\n');

    const fullText = `${aiResult?.schoolName || '학업성적관리규정'} 분석 결과\n${'='.repeat(50)}\n\n${aiResult?.summary || ''}\n\n${'='.repeat(50)}\n세부 오류 내역:\n${text}`;

    navigator.clipboard.writeText(fullText);
  }, [errorItems, deletedItems, aiResult]);

  const handleSaveHTML = useCallback(() => {
    const visibleItems = errorItems.filter(item => !deletedItems.has(item.id));

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${aiResult?.schoolName || '학업성적관리규정'} 분석 결과</title>
  <style>
    body { font-family: 'Malgun Gothic', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #5b21b6; border-bottom: 2px solid #5b21b6; padding-bottom: 10px; }
    h2 { color: #374151; margin-top: 30px; }
    .summary { background: #f3f4f6; padding: 20px; border-radius: 8px; white-space: pre-wrap; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #d1d5db; padding: 12px; text-align: left; }
    th { background: #5b21b6; color: white; }
    tr:nth-child(even) { background: #f9fafb; }
    .deleted { text-decoration: line-through; opacity: 0.5; }
    .footer { margin-top: 30px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${aiResult?.schoolName || '학업성적관리규정'} 분석 결과</h1>
  <p>모델: ${aiResult?.model?.includes('pro') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash'} | 분석일시: ${new Date(aiResult?.analyzedAt || '').toLocaleString('ko-KR')}</p>

  <h2>분석 결과 요약</h2>
  <div class="summary">${aiResult?.summary || ''}</div>

  <h2>세부 오류 내역</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 50px;">번호</th>
        <th style="width: 200px;">학업성적관리규정 기준</th>
        <th>오류 내용</th>
        <th style="width: 250px;">피드백</th>
      </tr>
    </thead>
    <tbody>
      ${visibleItems.map(item => `
      <tr>
        <td>${item.id}</td>
        <td><strong>${item.standard}</strong></td>
        <td>${item.errorContent}</td>
        <td>${item.feedback}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>본 분석 결과는 AI를 기반으로 하며 참고용으로만 사용하시기 바랍니다.</p>
  </div>
</body>
</html>
    `;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${aiResult?.schoolName || '학업성적관리규정'}_분석결과_${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [errorItems, deletedItems, aiResult]);

  const visibleItems = errorItems.filter(item => !deletedItems.has(item.id));
  const modelDisplayName = model.includes('pro') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash';

  return (
    <div className="space-y-6">
      {showSettings && !apiKey && (
        <ApiKeyInput onApiKeySet={handleApiKeySet} onModelChange={handleModelChange} currentModel={model} />
      )}

      {!apiKey && !showSettings && (
        <button
          onClick={() => setShowSettings(true)}
          className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm hover:bg-purple-200"
        >
          API 설정 열기
        </button>
      )}

      {apiKey && !showSettings && (
        <div className="flex items-center justify-between bg-white rounded-lg shadow-md p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span className="text-sm text-gray-600">API 연결됨</span>
            </div>
            <div className="text-sm text-gray-500">
              모델: <span className="font-medium text-gray-700">{modelDisplayName}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            >
              {showSettings ? '설정 닫기' : '설정 변경'}
            </button>
          </div>
        </div>
      )}

      {showSettings && apiKey && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">API 설정</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>
          <ApiKeyInput onApiKeySet={handleApiKeySet} onModelChange={handleModelChange} currentModel={model} />
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-800">학업성적관리규정 AI 분석</h2>
          <p className="text-sm text-gray-600 mt-1">기준: 2025 경기도 초등학교 학업성적관리규정 예시안</p>
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
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !apiKey}
              className="flex-1 py-3 px-6 rounded-lg font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white disabled:bg-gray-400"
            >
              {isAnalyzing ? `AI 분석 중... ${aiProgress}%` : 'AI 분석 시작'}
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              다시 시작
            </button>
          </div>
        )}
      </div>

      {aiResult && (
        <>
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">분석 결과 요약</h3>
              <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded">
                {aiResult.model?.includes('pro') ? 'Pro' : 'Flash'}
              </span>
            </div>
            {aiResult.schoolName && (
              <div className="mb-4 p-3 bg-purple-50 rounded-lg">
                <h4 className="font-medium text-purple-800">{aiResult.schoolName}</h4>
              </div>
            )}
            <div className="bg-gray-50 rounded-lg p-4">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap">{aiResult.summary}</pre>
            </div>
          </div>

          {visibleItems.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">세부 오류 내역</h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopyAll}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
                  >
                    전체 내용 복사
                  </button>
                  <button
                    onClick={handleSaveHTML}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
                  >
                    HTML로 저장
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="bg-purple-600 text-white p-3 text-left">번호</th>
                      <th className="bg-purple-600 text-white p-3 text-left">학업성적관리규정 기준</th>
                      <th className="bg-purple-600 text-white p-3 text-left">오류 내용</th>
                      <th className="bg-purple-600 text-white p-3 text-left">피드백</th>
                      <th className="bg-purple-600 text-white p-3 text-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item, idx) => (
                      <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="p-3 text-gray-500">{idx + 1}</td>
                        <td className="p-3">
                          <span className="font-medium text-purple-700">{item.standard}</span>
                        </td>
                        <td className="p-3 text-gray-700">{item.errorContent}</td>
                        <td className="p-3 text-gray-600">{item.feedback}</td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
                <span>총 {visibleItems.length}개 항목</span>
                {deletedItems.size > 0 && (
                  <span className="text-red-500">{deletedItems.size}개 항목 삭제됨</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}