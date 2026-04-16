import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '경기도교육청 학업성적관리규정 분석기',
  description: '2026 경기도 초등학교 학업성적관리 시행지침 분석 도구',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
