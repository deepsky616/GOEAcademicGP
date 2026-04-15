'use client';

import { useState, useCallback, useEffect } from 'react';
import { BASELINE_ARTICLES, getArticleKey } from '@/lib/baselineData';
import { analyzeWithAI, extractSchoolName, type ComparisonResult } from '@/lib/aiAnalysis';
import ApiKeyInput from './ApiKeyInput';

interface DiffResult {
  articleId: string;
  articleTitle: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  baselineContent: string;
  uploadedContent: string;
  diffHtml?: string;
}

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\u00A0\u3000]/g, ' ')
    .trim();
}

function computeDiff(baseline: string, uploaded: string): string {
  if (typeof window === 'undefined') return '';
  const dmp = new (require('diff-match-patch') as any)();
  const diffs = dmp.diff_main(baseline, uploaded);
  dmp.diff_cleanupSemantic(diffs);
  return dmp.diff_prettyHtml(diffs);
}

function extractArticlesFromText(text: string): Map<string, { title: string; content: string }> {
  const articles = new Map();
  const lines = text.split('\n');
  let currentArticle: string | null = null;
  let currentTitle = '';
  let currentContent: string[] = [];

  const articlePattern = /^제(\d+)조(?:[\(『])([^(『)]+)?[\)』]?/;
  const subArticlePattern = /^제(\d+)조의?\d?\s*[\(『]([^(『)]+)[\)』]?/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const mainMatch = trimmed.match(articlePattern);
    const subMatch = trimmed.match(subArticlePattern);

    if (mainMatch) {
      if (currentArticle) {
        articles.set(currentArticle, {
          title: currentTitle,
          content: currentContent.join('\n').trim()
        });
      }
      currentArticle = `제${mainMatch[1]}조`;
      currentTitle = mainMatch[2] || '';
      currentContent = [trimmed.replace(articlePattern, '').trim()];
    } else if (subMatch && currentArticle) {
      if (currentArticle) {
        articles.set(currentArticle, {
          title: currentTitle,
          content: currentContent.join('\n').trim()
        });
      }
      currentArticle = `제${subMatch[1]}조`;
      currentTitle = subMatch[2] || '';
      currentContent = [trimmed.replace(subArticlePattern, '').trim()];
    } else if (currentArticle) {
      currentContent.push(trimmed);
    }
  }

  if (currentArticle) {
    articles.set(currentArticle, {
      title: currentTitle,
      content: currentContent.join('\n').trim()
    });
  }

  return articles;
}

function compareWithBaseline(uploadedText: string): DiffResult[] {
  const uploadedArticles = extractArticlesFromText(uploadedText);
  const results: DiffResult[] = [];

  for (const baseline of BASELINE_ARTICLES) {
    const key = getArticleKey(baseline);
    const uploaded = uploadedArticles.get(key);

    if (!uploaded) {
      results.push({
        articleId: baseline.id,
        articleTitle: `${key} ${baseline.title}`,
        status: 'removed',
        baselineContent: baseline.content,
        uploadedContent: '',
      });
    } else {
      const normalizedBaseline = normalizeText(baseline.content);
      const normalizedUploaded = normalizeText(uploaded.content);
      const isModified = normalizedBaseline !== normalizedUploaded;

      results.push({
        articleId: baseline.id,
        articleTitle: `${key} ${baseline.title}`,
        status: isModified ? 'modified' : 'unchanged',
        baselineContent: baseline.content,
        uploadedContent: uploaded.content,
        diffHtml: isModified ? computeDiff(baseline.content, uploaded.content) : undefined,
      });
    }
  }

  for (const [key, data] of uploadedArticles) {
    const exists = BASELINE_ARTICLES.some(b => getArticleKey(b) === key);
    if (!exists) {
      results.push({
        articleId: `added-${key}`,
        articleTitle: `${key} ${data.title || '(제목 없음)'}`,
        status: 'added',
        baselineContent: '',
        uploadedContent: data.content,
      });
    }
  }

  return results;
}

export default function DocumentComparator() {
  const [mode, setMode] = useState<'basic' | 'ai'>('basic');
  const [apiKey, setApiKey] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<DiffResult[] | null>(null);
  const [aiResult, setAiResult] = useState<ComparisonResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'added' | 'removed' | 'modified'>('all');

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
    setResults(null);
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

  const handleBasicAnalyze = useCallback(async () => {
    if (!file) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const fullText = await extractTextFromPdf(file);
      const diffResults = compareWithBaseline(fullText);
      setResults(diffResults);
    } catch (err) {
      setError('PDF 분석 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [file]);

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

  const filteredResults = results?.filter(r => filter === 'all' || r.status === filter) ?? [];

  const stats = results ? {
    total: results.length,
    added: results.filter(r => r.status === 'added').length,
    removed: results.filter(r => r.status === 'removed').length,
    modified: results.filter(r => r.status === 'modified').length,
    unchanged: results.filter(r => r.status === 'unchanged').length,
  } : null;

  return (
    <div className="space-y-6">
      {!apiKey && mode === 'ai' && (
        <ApiKeyInput onApiKeySet={handleApiKeySet} />
      )}

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              학업성적관리규정 비교 분석
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              기준: 2025 경기도 초등학교 학업성적관리규정 예시안
            </p>
          </div>

          <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setMode('basic')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === 'basic'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              기본 비교
            </button>
            <button
              onClick={() => setMode('ai')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                mode === 'ai'
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>AI 분석</span>
              <span className={`text-xs ${apiKey ? 'text-green-300' : 'text-yellow-300'}`}>
                {apiKey ? '●' : '○'}
              </span>
            </button>
          </div>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="hidden"
            id="compare-upload"
          />
          <label htmlFor="compare-upload" className="cursor-pointer">
            <div className="text-blue-600 mb-2">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-600">
              {file ? file.name : '비교할 학교 학업성적관리규정 PDF를 선택하세요'}
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
            onClick={mode === 'ai' ? handleAIAnalyze : handleBasicAnalyze}
            disabled={isAnalyzing || (mode === 'ai' && !apiKey)}
            className={`mt-4 w-full py-3 px-6 rounded-lg font-medium transition-colors disabled:bg-gray-400 ${
              mode === 'ai'
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isAnalyzing
              ? mode === 'ai'
                ? `AI 분석 중... ${aiProgress}%`
                : '분석 중...'
              : mode === 'ai'
                ? apiKey
                  ? 'AI 분석 시작'
                  : 'API 키 설정 필요'
                : '비교 분석 시작'}
          </button>
        )}
      </div>

      {results && stats && mode === 'basic' && (
        <>
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold mb-4">기본 비교 결과</h3>
            <div className="grid grid-cols-5 gap-4 text-center">
              <div className="p-3 bg-gray-100 rounded-lg">
                <div className="text-2xl font-bold text-gray-700">{stats.total}</div>
                <div className="text-sm text-gray-500">전체</div>
              </div>
              <div className="p-3 bg-green-100 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{stats.added}</div>
                <div className="text-sm text-green-600">추가</div>
              </div>
              <div className="p-3 bg-red-100 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{stats.removed}</div>
                <div className="text-sm text-red-600">삭제</div>
              </div>
              <div className="p-3 bg-yellow-100 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">{stats.modified}</div>
                <div className="text-sm text-yellow-600">수정</div>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{stats.unchanged}</div>
                <div className="text-sm text-blue-600">동일</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2 flex-wrap">
              {(['all', 'added', 'removed', 'modified'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === f
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f === 'all' ? '전체' : f === 'added' ? '추가만' : f === 'removed' ? '삭제만' : '수정만'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {filteredResults.map(result => (
              <div
                key={result.articleId}
                className={`bg-white rounded-lg shadow-md p-6 border-l-4 ${
                  result.status === 'added' ? 'border-l-green-500' :
                  result.status === 'removed' ? 'border-l-red-500' :
                  result.status === 'modified' ? 'border-l-yellow-500' :
                  'border-l-gray-300'
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    result.status === 'added' ? 'bg-green-100 text-green-700' :
                    result.status === 'removed' ? 'bg-red-100 text-red-700' :
                    result.status === 'modified' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {result.status === 'added' ? '추가' :
                     result.status === 'removed' ? '삭제' :
                     result.status === 'modified' ? '수정' : '동일'}
                  </span>
                  <h4 className="font-semibold text-gray-800">{result.articleTitle}</h4>
                </div>

                {result.status === 'removed' && (
                  <div className="bg-red-50 rounded-lg p-4">
                    <p className="text-sm text-red-700 font-medium mb-2">삭제된 내용:</p>
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap">{result.baselineContent}</pre>
                  </div>
                )}

                {result.status === 'added' && (
                  <div className="bg-green-50 rounded-lg p-4">
                    <p className="text-sm text-green-700 font-medium mb-2">추가된 내용:</p>
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap">{result.uploadedContent}</pre>
                  </div>
                )}

                {result.status === 'modified' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-500 font-medium mb-2">예시안</p>
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-auto max-h-64">
                        {result.baselineContent}
                      </pre>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-500 font-medium mb-2">학교 규정</p>
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-auto max-h-64">
                        {result.uploadedContent}
                      </pre>
                    </div>
                  </div>
                )}

                {result.status === 'unchanged' && (
                  <p className="text-sm text-gray-500 italic">예시안과 동일합니다.</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {aiResult && mode === 'ai' && (
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
            <h4 className="text-sm font-medium text-gray-700 mb-2">AI가 분석한 조문 변경 사항</h4>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                AI의 상세 조문 분석은 AI 응답 전체를 확인하세요.
                조문별 추출 정보는 AI 응답 형식에 따라 표시됩니다.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { DiffResult };