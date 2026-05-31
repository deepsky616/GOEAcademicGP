'use client';

import { useState, useCallback, useEffect } from 'react';
import { analyzeWithAI, extractSchoolName } from '@/lib/aiAnalysis';
import type { ArticleFinding } from '@/lib/aiAnalysis';
import ApiKeyInput from './ApiKeyInput';

interface ErrorItem {
  id: number;
  article: string;
  errorType?: string;
  errorContent: string;
  feedback: string;
}

export interface PdfTextItemLike {
  str: string;
  transform?: unknown[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

interface PdfLineItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}

interface PdfLine {
  y: number;
  items: PdfLineItem[];
}

const PDF_LINE_Y_THRESHOLD = 3;
const PDF_COLUMN_GAP_RATIO = 0.7;

function isPdfTextItem(item: unknown): item is PdfTextItemLike {
  return Boolean(
    item &&
    typeof item === 'object' &&
    'str' in item &&
    typeof (item as { str?: unknown }).str === 'string'
  );
}

function getPdfItemPosition(item: PdfTextItemLike): { x: number; y: number } | null {
  const transform = item.transform;
  if (!Array.isArray(transform) || transform.length < 6) {
    return null;
  }

  const x = Number(transform[4]);
  const y = Number(transform[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

export function reconstructPageText(items: unknown[]): string {
  const lines: PdfLine[] = [];
  let forceNextLine = false;

  for (const rawItem of items) {
    if (!isPdfTextItem(rawItem) || rawItem.str.length === 0) {
      continue;
    }

    const position = getPdfItemPosition(rawItem);
    if (!position) {
      continue;
    }

    const lineItem: PdfLineItem = {
      text: rawItem.str,
      x: position.x,
      y: position.y,
      width: typeof rawItem.width === 'number' ? rawItem.width : 0,
      height: typeof rawItem.height === 'number' ? rawItem.height : 0,
      hasEOL: rawItem.hasEOL === true,
    };

    const lastLine = lines[lines.length - 1];
    if (!lastLine || forceNextLine || Math.abs(lastLine.y - lineItem.y) > PDF_LINE_Y_THRESHOLD) {
      lines.push({ y: lineItem.y, items: [lineItem] });
    } else {
      lastLine.items.push(lineItem);
      lastLine.y = (lastLine.y * (lastLine.items.length - 1) + lineItem.y) / lastLine.items.length;
    }

    forceNextLine = lineItem.hasEOL;
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const sortedItems = [...line.items].sort((a, b) => a.x - b.x);
      return sortedItems.reduce((lineText, item, index) => {
        const text = item.text.trim();
        if (!text) {
          return lineText;
        }
        if (index === 0 || !lineText) {
          return text;
        }

        const previous = sortedItems[index - 1];
        const previousEndX = previous.x + Math.max(previous.width, previous.text.length * Math.max(previous.height, 8) * 0.45);
        const gap = item.x - previousEndX;
        const averageHeight = Math.max(item.height, previous.height, 8);
        const separator = gap > averageHeight * PDF_COLUMN_GAP_RATIO ? '\t' : ' ';
        return lineText + separator + text;
      }, '');
    })
    .filter(Boolean)
    .join('\n');
}

function isPdfTextSubstantial(text: string): boolean {
  return text.replace(/\s/g, '').length >= 5;
}

type HwpErrorConstructor = new (...args: any[]) => Error;

export interface HwpTextExtractionDeps {
  hwpToText: (data: Uint8Array) => Promise<string>;
  hwpToHwpx: (data: Uint8Array) => Promise<Uint8Array>;
  HwpxReader: new () => {
    loadFromArrayBuffer: (buffer: ArrayBuffer) => Promise<void>;
    extractText: () => Promise<string>;
  };
  HwpEncryptedError: HwpErrorConstructor;
  HwpInvalidFormatError: HwpErrorConstructor;
  HwpUnsupportedError: HwpErrorConstructor;
}

function toStandaloneArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function getHwpExtractionFailureMessage(
  firstError: unknown,
  deps: Pick<HwpTextExtractionDeps, 'HwpEncryptedError' | 'HwpInvalidFormatError' | 'HwpUnsupportedError'>
): string {
  if (firstError instanceof deps.HwpEncryptedError) {
    return '암호가 설정된 HWP 파일은 분석할 수 없습니다. 암호를 해제하거나 HWPX/PDF로 변환해 올려주세요.';
  }
  if (firstError instanceof deps.HwpUnsupportedError || firstError instanceof deps.HwpInvalidFormatError) {
    return '이 HWP 형식(배포용 문서 또는 구버전 등)은 분석할 수 없습니다. 한글에서 HWPX 또는 PDF로 변환해 올려주세요.';
  }
  return 'HWP에서 텍스트를 추출하지 못했습니다. 한글에서 HWPX 또는 PDF로 변환해 올려주세요.';
}

export async function extractHwpTextWithFallback(
  data: Uint8Array,
  deps: HwpTextExtractionDeps,
  normalizeText: (text: string) => string = (text) => text
): Promise<string> {
  let firstError: unknown;

  try {
    const text = normalizeText(await deps.hwpToText(data));
    if (isPdfTextSubstantial(text)) {
      return text;
    }
  } catch (err: unknown) {
    firstError = err;
  }

  try {
    const hwpxBytes = await deps.hwpToHwpx(data);
    const reader = new deps.HwpxReader();
    await reader.loadFromArrayBuffer(toStandaloneArrayBuffer(hwpxBytes));
    const fallbackText = normalizeText(await reader.extractText());
    if (isPdfTextSubstantial(fallbackText)) {
      return fallbackText;
    }
  } catch {
    // 원본 HWP 파싱 오류 종류를 우선 보존한다.
  }

  throw new Error(getHwpExtractionFailureMessage(firstError, deps));
}

function parseAIResponseToErrors(summary: string): ErrorItem[] {
  const errors: ErrorItem[] = [];
  let id = 0;

  const errorTypePattern = /\*\*누락\/오류 유형:\*\*\s*([^\n]+)/i;

  const sections = summary.split(/##\s*\[/);

  for (const section of sections) {
    if (!section.trim()) continue;

    let articleNum = '';
    let articleTitle = '';
    let errorType = '';
    let errorContent = '';
    let feedback = '';

    const headerMatch = section.match(/^(제\d+조[^\]]*)\]\s*\(([^)]+)\)/);
    if (headerMatch) {
      articleNum = headerMatch[1].trim();
      articleTitle = headerMatch[2].trim();
    } else if (section.startsWith('제')) {
      const simpleMatch = section.match(/^(제\d+조[^:\n\]]*)/);
      if (simpleMatch) {
        articleNum = simpleMatch[1].trim();
      }
    }

    const body = section.replace(/^[\s\S]*?(?=\*\*|$)/, '');

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

function mapFindingsToErrors(findings: ArticleFinding[]): ErrorItem[] {
  return findings.map((finding, index) => ({
    id: index + 1,
    article: finding.article,
    errorType: finding.errorType,
    errorContent: finding.errorContent,
    feedback: finding.suggestion,
  }));
}

function getResultTitle(schoolName: string): string {
  return `${schoolName || '학업성적관리규정'} 분석 결과`;
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildAnalysisPlainText(
  items: ErrorItem[],
  schoolName: string,
  originalFileName: string,
  modelDisplayName: string,
  analyzedAt: string
): string {
  const title = getResultTitle(schoolName);
  const lines = [
    title,
    '',
    `분석파일명: ${originalFileName || '-'}`,
    `모델: ${modelDisplayName}`,
    `분석일시: ${analyzedAt || new Date().toLocaleString('ko-KR')}`,
    '',
    '세부 오류 내역',
    '',
  ];

  for (const [index, item] of items.entries()) {
    lines.push(
      `[${index + 1}] ${item.article} ${item.errorType ? item.errorType : ''}`.trim(),
      `오류: ${item.errorContent}`,
      `수정: ${item.feedback}`,
      ''
    );
  }

  lines.push('본 분석 결과는 AI를 기반으로 하며 참고용으로만 사용하시기 바랍니다.');
  return lines.join('\n');
}

function buildAnalysisHtml(
  items: ErrorItem[],
  schoolName: string,
  originalFileName: string,
  modelDisplayName: string,
  analyzedAt: string,
  printMode = false
): string {
  const title = getResultTitle(schoolName);
  const currentDateTime = analyzedAt || new Date().toLocaleString('ko-KR');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; color: #111827; }
    h1 { color: #5b21b6; border-bottom: 2px solid #5b21b6; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
    th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #5b21b6; color: white; }
    tr:nth-child(even) { background: #f9fafb; }
    .footer { margin-top: 30px; color: #6b7280; font-size: 12px; }
    .meta { margin-top: 10px; color: #6b7280; font-size: 14px; }
    ${printMode ? `
    @page { margin: 16mm; }
    @media print {
      body { max-width: none; padding: 0; }
      h1 { color: #111827; border-bottom-color: #111827; }
      th { background: #e5e7eb !important; color: #111827 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tr { break-inside: avoid; }
      .no-print { display: none; }
    }` : ''}
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <p>분석파일명: ${escapeHtml(originalFileName || '-')}</p>
    <p>모델: ${escapeHtml(modelDisplayName)} | 분석일시: ${escapeHtml(currentDateTime)}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 50px;">번호</th>
        <th style="width: 180px;">학업성적관리규정 기준</th>
        <th style="width: 80px;">유형</th>
        <th>오류 내용</th>
        <th style="width: 300px;">수정 제안</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(item.article)}</strong></td>
        <td>${escapeHtml(item.errorType || '-')}</td>
        <td style="color: #dc2626; font-weight: 500;">${escapeHtml(item.errorContent)}</td>
        <td>${escapeHtml(item.feedback)}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>본 분석 결과는 AI를 기반으로 하며 참고용으로만 사용하시기 바랍니다.</p>
  </div>
</body>
</html>`;
}

export default function DocumentComparator() {
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('gemini-2.5-flash');
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
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [analysisDone, setAnalysisDone] = useState(false);
  const [extractedTextLength, setExtractedTextLength] = useState(0);
  const [extractedPreview, setExtractedPreview] = useState('');
  const [showExtractedPreview, setShowExtractedPreview] = useState(false);
  const [lastSummary, setLastSummary] = useState('');
  const [showRawAiResponse, setShowRawAiResponse] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    const savedModel = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';

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
    const ext = selectedFile.name.toLowerCase().split('.').pop() || '';
    if (!['pdf', 'hwp', 'hwpx'].includes(ext)) {
      setError('PDF, HWP, HWPX 파일만 업로드 가능합니다.');
      setFile(null);
      return;
    }
    setError(null);
    setFile(selectedFile);
    setOriginalFileName(selectedFile.name);
    setErrorItems([]);
    setDeletedItems(new Set());
    setSchoolName('');
    setAnalyzedAt('');
    setAnalysisDone(false);
    setExtractedTextLength(0);
    setExtractedPreview('');
    setShowExtractedPreview(false);
    setLastSummary('');
    setShowRawAiResponse(false);
  }, []);

  const normalizePdfText = (text: string): string => {
    let normalized = text.replace(/([가-힣])-\s*\n\s*([가-힣])/g, '$1$2');
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    normalized = normalized.split('\n').map(line => line.trim()).join('\n');
    normalized = normalized.replace(/제\s+(\d+장|\d+조)/g, '제$1');
    return normalized;
  };

  const extractTextFromPdf = async (file: File): Promise<string> => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = reconstructPageText(content.items);
      fullText += pageText + '\n';
    }
    const normalizedText = normalizePdfText(fullText);
    if (!isPdfTextSubstantial(normalizedText)) {
      throw new Error('텍스트를 추출할 수 없는 PDF입니다(스캔본일 수 있음). HWPX 또는 텍스트 PDF로 올려주세요.');
    }
    return normalizedText;
  };

  const extractTextFromHwpx = async (file: File): Promise<string> => {
    const { HwpxReader } = await import('@ssabrojs/hwpxjs');
    const arrayBuffer = await file.arrayBuffer();
    const reader = new HwpxReader();
    await reader.loadFromArrayBuffer(arrayBuffer);
    const text = await reader.extractText();
    return normalizePdfText(text);
  };

  const extractTextFromHwp = async (file: File): Promise<string> => {
    const {
      HwpEncryptedError,
      HwpInvalidFormatError,
      HwpUnsupportedError,
      HwpxReader,
      hwpToHwpx,
      hwpToText,
    } = await import('@ssabrojs/hwpxjs');
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    return extractHwpTextWithFallback(
      uint8Array,
      {
        HwpEncryptedError,
        HwpInvalidFormatError,
        HwpUnsupportedError,
        HwpxReader,
        hwpToHwpx,
        hwpToText,
      },
      normalizePdfText
    );
  };

  const extractTextFromFile = async (file: File): Promise<string> => {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    if (ext === 'pdf') {
      return extractTextFromPdf(file);
    } else if (ext === 'hwpx') {
      return extractTextFromHwpx(file);
    } else if (ext === 'hwp') {
      return extractTextFromHwp(file);
    }
    throw new Error('지원하지 않는 파일 형식입니다.');
  };

  const handleAnalyze = useCallback(async () => {
    if (!file || !apiKey) return;

    setIsAnalyzing(true);
    setError(null);
    setAiProgress(0);
    setAiStatus('파일 텍스트 추출 중...');
    setErrorItems([]);
    setDeletedItems(new Set());
    setAnalysisDone(false);
    setExtractedTextLength(0);
    setExtractedPreview('');
    setShowExtractedPreview(false);
    setLastSummary('');
    setShowRawAiResponse(false);

    try {
      const fullText = await extractTextFromFile(file);
      const textLength = fullText.length;
      setExtractedTextLength(textLength);
      setExtractedPreview(fullText.slice(0, 500));
      const extractedSchoolName = extractSchoolName(fullText);
      if (extractedSchoolName) {
        setSchoolName(extractedSchoolName);
      }
      setAnalyzedAt(new Date().toLocaleString('ko-KR'));
      setAiStatus(`텍스트 추출 완료(${textLength}자) — AI 분석 중...`);

      const result = await analyzeWithAI(apiKey, fullText, model, (progress, status) => {
        setAiProgress(progress);
        if (status) setAiStatus(status);
      });
      setLastSummary(result.summary ?? '');
      setShowRawAiResponse(false);

      const structuredErrors = mapFindingsToErrors(result.findings ?? []);
      const parsedErrors = structuredErrors.length > 0
        ? structuredErrors
        : result.summary
          ? parseAIResponseToErrors(result.summary)
          : [];
      setErrorItems(parsedErrors);
      setAnalysisDone(true);
    } catch (err: unknown) {
      setAnalysisDone(false);
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
    setOriginalFileName('');
    setAnalysisDone(false);
    setExtractedTextLength(0);
    setExtractedPreview('');
    setShowExtractedPreview(false);
    setLastSummary('');
    setShowRawAiResponse(false);
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
    const modelDisplayName = model.includes('pro') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash';
    const html = buildAnalysisHtml(visibleItems, schoolName, originalFileName, modelDisplayName, analyzedAt);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `2026_${schoolName || '학업성적관리규정'}_학업성적관리규정_분석결과_${getTodayString()}.html`);
  }, [errorItems, deletedItems, schoolName, model, originalFileName, analyzedAt]);

  const handleSaveHwpx = useCallback(async () => {
    try {
      const visibleItems = errorItems.filter(item => !deletedItems.has(item.id));
      const { HwpxWriter } = await import('@ssabrojs/hwpxjs');
      const modelDisplayName = model.includes('pro') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash';
      const writer = new HwpxWriter();
      const bytes = await writer.createFromPlainText(
        buildAnalysisPlainText(visibleItems, schoolName, originalFileName, modelDisplayName, analyzedAt),
        { title: getResultTitle(schoolName), creator: 'GOEAcademicGP' }
      );
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: 'application/owpml' });
      downloadBlob(blob, `2026_${schoolName || '학업성적관리규정'}_분석결과_${getTodayString()}.hwpx`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      setError(`HWPX 저장 중 오류가 발생했습니다: ${message}`);
    }
  }, [errorItems, deletedItems, schoolName, model, originalFileName, analyzedAt]);

  const handlePrintPdf = useCallback(() => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError('팝업이 차단되어 인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 시도해주세요.');
      return;
    }

    const visibleItems = errorItems.filter(item => !deletedItems.has(item.id));
    const modelDisplayName = model.includes('pro') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash';
    printWindow.document.open();
    printWindow.document.write(buildAnalysisHtml(visibleItems, schoolName, originalFileName, modelDisplayName, analyzedAt, true));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [errorItems, deletedItems, schoolName, model, originalFileName, analyzedAt]);

  const visibleItems = errorItems.filter(item => !deletedItems.has(item.id));
  const modelDisplayName = model.includes('pro') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash';
  const shouldShowEmptyResult = analysisDone && !isAnalyzing && !error && visibleItems.length === 0;

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
              const ext = file.name.toLowerCase().split('.').pop() || '';
              if (['pdf', 'hwp', 'hwpx'].includes(ext)) {
                const fakeEvent = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
                handleFileChange(fakeEvent);
              } else {
                setError('PDF, HWP, HWPX 파일만 업로드 가능합니다.');
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
          <input type="file" accept=".pdf,.hwp,.hwpx" onChange={handleFileChange} className="hidden" id="compare-upload" />
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
                  <span className="block mb-1">PDF, HWP, HWPX 파일을 드래그하거나 클릭하여 업로드</span>
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

      {shouldShowEmptyResult && (
        <div className="bg-white rounded-lg shadow-md p-6 border border-green-100">
          <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
            <h3 className="text-lg font-semibold text-green-800 mb-2">분석 완료 — 발견된 오류·수정사항이 없습니다</h3>
            <p className="text-sm text-green-700">
              기준 예시안과 비교한 결과 보고할 차이가 없거나, 업로드한 문서에서 조문 구조를 충분히 인식하지 못했을 수 있습니다.
            </p>
          </div>

          <div className="space-y-3 text-sm text-gray-700">
            <p>
              추출된 텍스트 길이:{' '}
              <span className="font-semibold text-gray-900">{extractedTextLength.toLocaleString('ko-KR')}자</span>
            </p>
            {extractedTextLength < 100 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 font-medium text-amber-800">
                문서에서 텍스트가 거의 추출되지 않았습니다. HWP 대신 HWPX 또는 텍스트 PDF로 변환해 올려보세요.
              </p>
            )}

            {extractedPreview && (
              <div>
                <button
                  onClick={() => setShowExtractedPreview(prev => !prev)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
                  type="button"
                >
                  {showExtractedPreview ? '추출 텍스트 미리보기 닫기' : '추출 텍스트 미리보기 보기'}
                </button>
                {showExtractedPreview && (
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-xs leading-5 text-gray-800">
                    {extractedPreview}
                  </pre>
                )}
              </div>
            )}

            <div>
              <button
                onClick={() => setShowRawAiResponse(prev => !prev)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
                type="button"
              >
                {showRawAiResponse ? 'AI 응답 원문 닫기' : 'AI 응답 원문 보기'}
              </button>
              {showRawAiResponse && (
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-950 p-4 font-mono text-xs leading-5 text-gray-100">
                  {lastSummary ? lastSummary.slice(0, 1000) : 'AI 응답 원문이 비어 있습니다.'}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

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

          <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
            <h3 className="text-lg font-semibold">세부 오류 내역</h3>
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex flex-wrap gap-2">
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
                <button
                  onClick={handleSaveHwpx}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
                >
                  HWPX로 저장
                </button>
                <button
                  onClick={handlePrintPdf}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800"
                >
                  PDF로 저장(인쇄)
                </button>
              </div>
              <p className="text-xs text-gray-500">
                HWP가 필요하면 HWPX로 받아 한글에서 다른 이름으로 저장(.hwp)하세요.
              </p>
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
