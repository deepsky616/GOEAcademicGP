'use client';

import { useState, useCallback } from 'react';

interface ApiKeyInputProps {
  onApiKeySet: (apiKey: string) => void;
}

export default function ApiKeyInput({ onApiKeySet }: ApiKeyInputProps) {
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gemini_api_key') || '';
    }
    return '';
  });
  const [isValid, setIsValid] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleSave = useCallback(() => {
    if (apiKey.trim()) {
      localStorage.setItem('gemini_api_key', apiKey.trim());
      setIsValid(true);
      onApiKeySet(apiKey.trim());
    }
  }, [apiKey, onApiKeySet]);

  const handleClear = useCallback(() => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setIsValid(false);
    onApiKeySet('');
  }, [onApiKeySet]);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">AI API 키 설정</h3>
      <p className="text-sm text-gray-600 mb-4">
        Google AI (Gemini) API 키를 입력하면 규정 비교 분석을 AI가 수행합니다.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Gemini API 키
          </label>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setIsValid(false);
              }}
              placeholder="AIza..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              {showKey ? '숨기기' : '보기'}
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!apiKey.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            저장
          </button>
          <button
            onClick={handleClear}
            className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            삭제
          </button>
        </div>

        <div className="text-xs text-gray-500">
          <p>※ API 키는 브라우저의 localStorage에 안전하게 저장됩니다.</p>
          <p>※ Gemini API 키는{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Google AI Studio
            </a>
            에서 무료로 발급받을 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}