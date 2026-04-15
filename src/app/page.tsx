'use client';

import { useState, useCallback } from 'react';
import PdfUploader from '@/components/PdfUploader';
import AnalysisResult from '@/components/AnalysisResult';

interface AnalysisData {
  documentType: string;
  keyFindings: string[];
  extractedText: string;
}

export default function Home() {
  const [analysisResult, setAnalysisResult] = useState<AnalysisData | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalysisComplete = useCallback((result: AnalysisData) => {
    setAnalysisResult(result);
    setIsAnalyzing(false);
  }, []);

  const handleAnalyzeStart = useCallback(() => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
  }, []);

  return (
    <main className="min-h-screen">
      <header className="bg-blue-800 text-white py-6 px-4 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold">경기도교육청 학업성적 분석기</h1>
          <p className="text-blue-200 mt-1">초등학교 학업성적관리 시행지침 분석 도구</p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
        <PdfUploader
          onAnalysisStart={handleAnalyzeStart}
          onAnalysisComplete={handleAnalysisComplete}
        />

        {isAnalyzing && (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="animate-pulse">
              <div className="h-4 w-4 bg-blue-600 rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600">문서를 분석 중입니다...</p>
            </div>
          </div>
        )}

        {analysisResult && <AnalysisResult data={analysisResult} />}
      </div>
    </main>
  );
}