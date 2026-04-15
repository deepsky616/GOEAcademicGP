'use client';

import { useState, useCallback } from 'react';

interface PdfUploaderProps {
  onAnalysisStart: () => void;
  onAnalysisComplete: (result: {
    documentType: string;
    keyFindings: string[];
    extractedText: string;
  }) => void;
}

const DOCUMENT_TYPES = {
  '학업성적관리 시행지침': {
    patterns: ['학업성적관리', ' 시행지침', '초등학교'],
    keySections: [
      '성적 산출 방법',
      '등급 체계',
      '학업성적 평가',
      '신고성적관리',
      '결시 처리',
    ],
  },
  '학교생활기록부 기재요령': {
    patterns: ['학교생활기록', '기재요령', '기록지침'],
    keySections: [
      '기록 원칙',
      '세부능력 및 특기사항',
      '출결 현황',
      '각호사실',
    ],
  },
  '교육부훈령': {
    patterns: ['교육부훈령', '학교생활기록', '관리지침'],
    keySections: [
      '기본 방향',
      '기록 작성',
      '관리 체계',
    ],
  },
};

function detectDocumentType(text: string): string {
  let bestMatch = '일반 문서';
  let highestScore = 0;

  for (const [docType, config] of Object.entries(DOCUMENT_TYPES)) {
    let score = 0;
    for (const pattern of config.patterns) {
      if (text.includes(pattern)) {
        score += pattern.length;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestMatch = docType;
    }
  }

  return bestMatch;
}

function extractKeyFindings(text: string, documentType: string): string[] {
  const findings: string[] = [];
  const config = DOCUMENT_TYPES[documentType as keyof typeof DOCUMENT_TYPES];

  if (!config) {
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    return lines.slice(0, 5).map((line) => line.trim());
  }

  for (const section of config.keySections) {
    if (text.includes(section)) {
      findings.push(`${section} 관련 조항 발견`);
    }
  }

  return findings.length > 0 ? findings : ['문서가 인식되었으나 주요 섹션 정보가 충분하지 않습니다.'];
}

export default function PdfUploader({ onAnalysisStart, onAnalysisComplete }: PdfUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!file) return;

    onAnalysisStart();
    setError(null);

    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let fullText = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: unknown) => ('str' in (item as Record<string, unknown>) ? (item as { str: string }).str : ''))
          .join(' ');
        fullText += pageText + '\n';
      }

      const documentType = detectDocumentType(fullText);
      const keyFindings = extractKeyFindings(fullText, documentType);

      onAnalysisComplete({
        documentType,
        keyFindings,
        extractedText: fullText.slice(0, 2000),
      });
    } catch (err) {
      setError('PDF 분석 중 오류가 발생했습니다.');
      onAnalysisComplete({
        documentType: '알 수 없음',
        keyFindings: ['분석 실패'],
        extractedText: '',
      });
    }
  }, [file, onAnalysisStart, onAnalysisComplete]);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">PDF 문서 업로드</h2>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
        <input
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          className="hidden"
          id="pdf-upload"
        />
        <label htmlFor="pdf-upload" className="cursor-pointer">
          <div className="text-blue-600 mb-2">
            <svg
              className="w-12 h-12 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <p className="text-gray-600">
            {file ? file.name : 'PDF 파일을 드래그하거나 클릭하여 선택하세요'}
          </p>
          <p className="text-sm text-gray-400 mt-1">최대 10MB</p>
        </label>
      </div>

      {error && (
        <p className="text-red-600 text-sm mt-2">{error}</p>
      )}

      {file && (
        <button
          onClick={handleAnalyze}
          className="mt-4 w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          분석 시작
        </button>
      )}
    </div>
  );
}