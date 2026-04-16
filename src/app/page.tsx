'use client';

import DocumentComparator from '@/components/DocumentComparator';

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="bg-blue-800 text-white py-6 px-4 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold">경기도교육청 초등학교 학업성적관리규정 분석기</h1>
          <p className="text-blue-200 mt-1">2026 단위학교 학업성적관리규정(예시안) 비교 분석</p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto py-8 px-4">
        <DocumentComparator />
      </div>
    </main>
  );
}
