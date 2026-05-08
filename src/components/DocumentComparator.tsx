'use client';

import { useState, useCallback, useEffect } from 'react';
import { analyzeWithAI, extractSchoolName } from '@/lib/aiAnalysis';
import ApiKeyInput from './ApiKeyInput';

interface ErrorItem {
  id: number;
  article: string;
  errorType?: string;
  errorContent: string;
  feedback: string;
}

function parseAIResponseToErrors(summary: string): ErrorItem[] {
  const errors: ErrorItem[] = [];
  let id = 0;

  const articlePattern = /##\s*\[(제\d+조[^\]]*)\]\s*\(([^)]+)\)|##\s*\[(제\d+조[^]]*)\]/g;
  const errorPattern = /\*\*오류 내용:\*\*\s*([\s\S]*?)(?=\*\*수정 제안:\*\*|\*\*피드백:\*\*|##|$)/i;
  const feedbackPattern = /\*\*수정 제안:\*\*\s*([\s\S]*?)(?=\*\*오류 내용:\*\*|##|$)/i;
  const feedbackAltPattern = /\*\*피드백:\*\*\s*([\s\S]*?)(?=\*\*오류 내용:\*\*|##|$)/i;
  const errorTypePattern = /\*\*누락\/오류 유형:\*\*\s*([^\n]+)/i;

  const sections = summary.split(/##\s*\[/);

  for (const section of sections) {
    if (!section.trim()) continue;

    let articleNum = '';
    let articleTitle = '';
    let errorType = '';
    let errorContent = '';
    let feedback = '';

    const headerMatch = section.match(/^(제\d+조[^]]*)\]\s*\(([^)]+)\)/);
    if (headerMatch) {
      articleNum = headerMatch[1].trim();
      articleTitle = headerMatch[2].trim();
    } else if (section.startsWith('제')) {
      const simpleMatch = section.match(/^(제\d+조[^:\n]*)/);
      if (simpleMatch) {
        articleNum = simpleMatch[1].trim();
      }
    }

    const body = section.replace(/^[^]*?(?=\*\*|$)/, '');

    const errorTypeMatch = body.match(errorTypePattern);
    if (errorTypeMatch) {
      errorType = errorTypeMatch[1].trim();
    }

    const errorMatch = body.match(/\*\*오류 내용:\*\*\s*([\s\S]*?)(?=\*\*수정 제안:\*\*|\*\*피드백:\*\*|$)/i);
    if (errorMatch) {
      errorContent = errorMatch[1].trim().replace(/\n+/g, ' ');
    }

    const feedbackMatch = body.match(/\*\*수정 제안:\*\*\s*([\s\S]*?)(?=##|$)/i);
    if (feedbackMatch) {
      feedback = feedbackMatch[1].trim().replace(/\n+/g, ' ');
    } else {
      const feedbackAltMatch = body.match(/\*\*피드백:\*\*\s*([\s\S]*?)(?=##|$)/i);
      if (feedbackAltMatch) {
        feedback = feedbackAltMatch[1].trim().replace(/\n+/g, ' ');
      }
    }

    if (errorContent || feedback) {
      id++;
      errors.push({
        id,
        article: articleNum || '학업성적관리규정',
        errorType: errorType || undefined,
        errorContent: errorContent || feedback || '내용 없음',
        feedback: feedback || '수정 제안 없음',
      });
    }
  }

  if (errors.length === 0) {
    const lines = summary.split('\n');
    let currentArticle = '';
    let currentError: string[] = [];
    let currentFeedback: string[] = [];
    let mode: 'error' | 'feedback' | 'none' = 'none';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('##') || trimmed.startsWith('제')) {
        if (currentArticle && currentError.length > 0) {
          id++;
          errors.push({
            id,
            article: currentArticle,
            errorContent: currentError.join(' ').trim(),
            feedback: currentFeedback.join(' ').trim(),
          });
        }
        const match = trimmed.match(/제\d+조[^:\n]*/);
        if (match) {
          currentArticle = match[0];
        }
        currentError = [];
        currentFeedback = [];
        mode = 'none';
        continue;
      }

      if (trimmed.includes('오류 내용')) {
        mode = 'error';
        const content = trimmed.replace(/.*오류 내용[：:]\s*/, '');
        if (content) currentError.push(content);
        continue;
      }

      if (trimmed.includes('수정 제안') || trimmed.includes('피드백')) {
        mode = 'feedback';
        const content = trimmed.replace(/.*수정 제안[：:]\s*/, '').replace(/.*피드백[：:]\s*/, '');
        if (content) currentFeedback.push(content);
        continue;
      }

      if (mode === 'error' && trimmed) {
        currentError.push(trimmed.replace(/^[-\•]\s*/, ''));
      } else if (mode === 'feedback' && trimmed) {
        currentFeedback.push(trimmed.replace(/^[-\•]\s*/, ''));
      }
    }

    if (currentArticle && currentError.length > 0) {
      id++;
      errors.push({
        id,
        article: currentArticle,
        errorContent: currentError.join(' ').trim(),
        feedback: currentFeedback.join(' ').trim(),
      });
    }
  }

  return errors;
}

export default function DocumentComparator() {
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('gemini-2.5-flash-preview-0520');
  const [showSettings, setShowSettings] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiStatus, setAiStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<ErrorItem[]>([]);
  const [deletedItems, setDeletedItems] = useState<Set<number>>(new Set());
  const [schoolName, setSchoolName] = useState<string>('');
  const [analyzedAt, setAnalyzedAt] = useState<string>('');

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    const savedModel = localStorage.getItem('gemini_model') || 'gemini-2.5-flash-preview-0520';

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
    setErrorItems([]);
    setDeletedItems(new Set());
    setSchoolName('');
    setAnalyzedAt('');
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
    setAiStatus('PDF 텍스트 추출 중...');
    setErrorItems([]);
    setDeletedItems(new Set());

    try {
      const fullText = await extractTextFromPdf(file);
      const extractedSchoolName = extractSchoolName(fullText);
      if (extractedSchoolName) {
        setSchoolName(extractedSchoolName);
      }
      setAnalyzedAt(new Date().toLocaleString('ko-KR'));
      setAiStatus('AI 분석 준비 중...');

      const result = await analyzeWithAI(apiKey, fullText, model, (progress, status) => {
        setAiProgress(progress);
        if (status) setAiStatus(status);
      });

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
      setAiStatus('');
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
    setErrorItems([]);
    setDeletedItems(new Set());
    setError(null);
    setAiProgress(0);
    setAiStatus('');
    setSchoolName('');
    setAnalyzedAt('');
  }, []);

  const handleCopyAll = useCallback(() => {
    const visibleItems = errorItems.filter(item => !deletedItems.has(item.id));
    const text = visibleItems.map(item =>
      `[${item.article}]\n오류: ${item.errorContent}\n수정: ${item.feedback}\n`
    ).join('\n');

    const fullText = `${schoolName || '학업성적관리규정'} 분석 결과\n${'='.repeat(50)}\n\n${text}`;

    navigator.clipboard.writeText(fullText);
  }, [errorItems, deletedItems, schoolName]);

  const handleSaveHTML = useCallback(() => {
    const visibleItems = errorItems.filter(item => !deletedItems.has(item.id));

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${schoolName || '학업성적관리규정'} 분석 결과</title>
  <style>
    body { font-family: 'Malgun Gothic', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #5b21b6; border-bottom: 2px solid #5b21b6; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #d1d5db; padding: 12px; text-align: left; }
    th { background: #5b21b6; color: white; }
    tr:nth-child(even) { background: #f9fafb; }
    .footer { margin-top: 30px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${schoolName || '학업성적관리규정'} 분석 결과</h1>
  <p>모델: ${model.includes('pro') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash'} | 분석일시: ${analyzedAt}</p>

  <table>
    <thead>
      <tr>
        <th style="width: 50px;">번호</th>
        <th style="width: 200px;">학업성적관리규정 기준</th>
        <th>오류 내용</th>
        <th style="width: 300px;">수정 제안</th>
      </tr>
    </thead>
    <tbody>
      ${visibleItems.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${item.article}</strong></td>
        <td style="color: #dc2626; font-weight: 500;">${item.errorContent}</td>
        <td>${item.feedback}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>본 분석 결과는 AI를 기반으로 하며 참고용으로만 사용하시기 바랍니다.</p>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `2026_${schoolName || '학업성적관리규정'}_학업성적관리규정_분석결과_${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [errorItems, deletedItems, schoolName, model, analyzedAt]);

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
            <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-gray-700">✕</button>
          </div>
          <ApiKeyInput onApiKeySet={handleApiKeySet} onModelChange={handleModelChange} currentModel={model} />
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-800">학업성적관리규정 AI 분석</h2>
          <p className="text-sm text-gray-600 mt-1">기준: 2026 경기도 초등학교 학업성적관리규정 예시안</p>
        </div>

        <div
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center transition-all duration-300 cursor-pointer group relative overflow-hidden"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
              const file = files[0];
              if (file.type === 'application/pdf') {
                const fakeEvent = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
                handleFileChange(fakeEvent);
              } else {
                setError('PDF 파일만 업로드 가능합니다.');
              }
            }
          }}
          onMouseEnter={() => {
            const label = document.querySelector('label[for="compare-upload"]');
            if (label) {
              (label as HTMLElement).style.transform = 'scale(1.05)';
              (label as HTMLElement).style.color = '#7c3aed';
            }
          }}
          onMouseLeave={() => {
            const label = document.querySelector('label[for="compare-upload"]');
            if (label) {
              (label as HTMLElement).style.transform = 'scale(1)';
              (label as HTMLElement).style.color = '#6b7280';
            }
          }}
          style={{}}
        >
          <input type="file" accept=".pdf" onChange={handleFileChange} className="hidden" id="compare-upload" />
          <label htmlFor="compare-upload" className="cursor-pointer transition-all duration-300" style={{ color: '#6b7280' }}>
            <div className="mb-4 relative">
              <div className="absolute inset-0 bg-purple-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform scale-150"></div>
              <svg className="w-16 h-16 mx-auto relative z-10 transition-transform duration-300 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-base font-medium transition-colors duration-300">
              {file ? (
                <span className="text-purple-600 font-semibold">{file.name}</span>
              ) : (
                <>
                  <span className="block mb-1">PDF 파일을 드래그하거나 클릭하여 업로드</span>
                  <span className="text-xs text-gray-400">또는 클릭하여 파일 선택</span>
                </>
              )}
            </p>
            {file && (
              <p className="text-sm text-gray-400 mt-2">다른 파일을 업로드하려면 클릭하세요</p>
            )}
          </label>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {file && (
          <div className="mt-4">
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !apiKey}
              className="w-full py-3 px-6 rounded-lg font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white disabled:bg-gray-400"
            >
              {isAnalyzing ? `AI 분석 중... ${aiProgress}%` : 'AI 분석 시작'}
            </button>
            {isAnalyzing && (
              <div className="mt-3">
                <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-purple-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${aiProgress}%` }}
                  />
                </div>
                {aiStatus && (
                  <p className="text-sm text-gray-600 mt-2 text-center">
                    {aiStatus.includes('AI 분석') ? aiStatus : `🤖 ${aiStatus}`}
                  </p>
                )}
              </div>
            )}
            <button onClick={handleReset} className="mt-2 w-full px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
              다시 시작
            </button>
          </div>
        )}
      </div>

      {visibleItems.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
            <h3 className="text-lg font-semibold text-purple-800 mb-2">분석 결과 요약</h3>
            <p className="text-sm text-purple-700">
              {schoolName && <span className="font-medium">{schoolName}</span>}
              {schoolName && '의 '}학업성적관리규정을 분석한 결과,{' '}
              <span className="font-bold text-purple-900">{visibleItems.length}개</span>의 오류/수정 사항이 발견되었습니다.
            </p>
          </div>

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
                  <th className="bg-purple-600 text-white p-3 text-center">유형</th>
                  <th className="bg-purple-600 text-white p-3 text-left">오류 내용</th>
                  <th className="bg-purple-600 text-white p-3 text-left">수정 제안</th>
                  <th className="bg-purple-600 text-white p-3 text-center">삭제</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item, idx) => (
                  <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="p-3 text-gray-500">{idx + 1}</td>
                    <td className="p-3">
                      <span className="font-medium text-purple-700">{item.article}</span>
                    </td>
                    <td className="p-3 text-center">
                      {item.errorType && (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          item.errorType.includes('누락') ? 'bg-orange-100 text-orange-700' :
                          item.errorType.includes('오류') ? 'bg-red-100 text-red-700' :
                          item.errorType.includes('부족') ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {item.errorType}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-red-600 font-medium">{item.errorContent}</td>
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
    </div>
  );
}