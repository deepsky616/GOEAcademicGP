'use client';

interface AnalysisResultProps {
  data: {
    documentType: string;
    keyFindings: string[];
    extractedText: string;
  };
}

export default function AnalysisResult({ data }: AnalysisResultProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">분석 결과</h2>

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">
            문서 유형
          </h3>
          <p className="text-lg text-gray-900 bg-blue-50 px-4 py-2 rounded-lg inline-block">
            {data.documentType}
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
            주요 발견 사항
          </h3>
          <ul className="space-y-2">
            {data.keyFindings.map((finding, index) => (
              <li
                key={index}
                className="flex items-start gap-3 text-gray-700"
              >
                <span className="w-2 h-2 bg-blue-600 rounded-full mt-2 flex-shrink-0" />
                {finding}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
            추출된 텍스트 (첫 2000자)
          </h3>
          <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
              {data.extractedText || '텍스트를 추출할 수 없습니다.'}
            </pre>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <button
            onClick={() => {
              navigator.clipboard.writeText(data.extractedText);
            }}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            텍스트 복사하기
          </button>
        </div>
      </div>
    </div>
  );
}