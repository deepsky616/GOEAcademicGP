'use client';

import { useState, useCallback } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ApiKeyInputProps {
  onApiKeySet: (apiKey: string) => void;
  onModelChange?: (model: string) => void;
  currentModel?: string;
}

const MODELS = [
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', description: '빠른 성능, 일상적인 작업에 권장' },
  { id: 'gemini-2.5-pro-preview-0520', name: 'Gemini 2.5 Pro', description: '향상된 성능, 복잡한 분석에 적합' },
];

export default function ApiKeyInput({ onApiKeySet, onModelChange, currentModel = 'gemini-2.5-flash-preview-05-20' }: ApiKeyInputProps) {
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gemini_api_key') || '';
    }
    return '';
  });
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const [isValid, setIsValid] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');

  const handleSave = useCallback(() => {
    if (apiKey.trim()) {
      localStorage.setItem('gemini_api_key', apiKey.trim());
      localStorage.setItem('gemini_model', selectedModel);
      setIsValid(true);
      onApiKeySet(apiKey.trim());
      onModelChange?.(selectedModel);
    }
  }, [apiKey, selectedModel, onApiKeySet, onModelChange]);

  const handleClear = useCallback(() => {
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('gemini_model');
    setApiKey('');
    setIsValid(false);
    setTestStatus('idle');
    setTestMessage('');
    onApiKeySet('');
  }, [onApiKeySet]);

  const handleTest = useCallback(async () => {
    if (!apiKey.trim()) return;

    setTestStatus('testing');
    setTestMessage('');

    try {
      const genAI = new GoogleGenerativeAI(apiKey.trim());
      const model = genAI.getGenerativeModel({ model: selectedModel });

      const result = await model.generateContent('안녕하세요. 이 메시지는 API 연결 테스트입니다. "성공"이라고만 한 글자로 답변해주세요.');
      const response = result.response;
      const text = response.text().trim();

      if (text.includes('성공') || text.includes('OK') || text.includes('테스트')) {
        setTestStatus('success');
        setTestMessage('API 연결 성공! 정상 작동합니다.');
      } else {
        setTestStatus('success');
        setTestMessage(`API 연결 성공! 응답: ${text}`);
      }
    } catch (err: unknown) {
      setTestStatus('error');
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      if (message.includes('API_KEY') || message.includes('key')) {
        setTestMessage('유효하지 않은 API 키입니다.');
      } else if (message.includes('quota') || message.includes('limit')) {
        setTestMessage('API 사용량이 초과되었습니다.');
      } else if (message.includes('not available') || message.includes('no longer available')) {
        setTestMessage(`선택한 모델(${selectedModel})을 사용할 수 없습니다. 다른 모델을 선택해주세요.`);
      } else {
        setTestMessage(`연결 실패: ${message}`);
      }
    }
  }, [apiKey, selectedModel]);

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    if (isValid) {
      localStorage.setItem('gemini_model', modelId);
      onModelChange?.(modelId);
    }
  }, [isValid, onModelChange]);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">AI API 설정</h3>
      <p className="text-sm text-gray-600 mb-4">
        Google AI API 키를 입력하면 규정 비교 분석을 AI가 수행합니다.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            API 키
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
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
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

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            AI 모델 선택
          </label>
          <div className="space-y-2">
            {MODELS.map(model => (
              <label
                key={model.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedModel === model.id
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-purple-300'
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={model.id}
                  checked={selectedModel === model.id}
                  onChange={() => handleModelChange(model.id)}
                  className="mt-1"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{model.name}</span>
                    {model.id === 'gemini-2.5-flash-preview-05-20' && (
                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">권장</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{model.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!apiKey.trim()}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
          >
            저장
          </button>
          <button
            onClick={handleTest}
            disabled={!apiKey.trim() || testStatus === 'testing'}
            className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {testStatus === 'testing' ? '테스트 중...' : 'API 테스트'}
          </button>
          <button
            onClick={handleClear}
            className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            삭제
          </button>
        </div>

        {testMessage && (
          <div className={`p-3 rounded-lg text-sm ${
            testStatus === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
            testStatus === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
            'bg-gray-50 text-gray-700'
          }`}>
            {testStatus === 'success' && <span className="mr-2">✓</span>}
            {testStatus === 'error' && <span className="mr-2">✗</span>}
            {testMessage}
          </div>
        )}

        <div className="text-xs text-gray-500">
          <p>※ API 키는 브라우저의 localStorage에 안전하게 저장됩니다.</p>
          <p>※ Gemini API 키는{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-600 hover:underline"
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