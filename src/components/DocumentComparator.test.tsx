import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DocumentComparator from './DocumentComparator';

// 외부 의존성 mock
vi.mock('./ApiKeyInput', () => ({
  default: ({ currentModel }: { currentModel?: string }) => (
    <div data-testid="api-key-input" data-model={currentModel} />
  ),
}));

vi.mock('@/lib/aiAnalysis', () => ({
  analyzeWithAI: vi.fn(),
  extractSchoolName: vi.fn(),
}));

vi.mock('@/lib/baselineData', () => ({
  BASELINE_ARTICLES: [],
  getArticleKey: vi.fn(),
}));

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('DocumentComparator — 기본 모델 상태', () => {
  beforeEach(() => localStorageMock.clear());

  it('저장된 API 키가 없으면 설정 패널이 표시되어야 한다', () => {
    render(<DocumentComparator />);
    expect(screen.getByTestId('api-key-input')).toBeInTheDocument();
  });

  it('API 설정 패널에 전달되는 기본 모델이 2.5 Flash이어야 한다', () => {
    render(<DocumentComparator />);
    const apiKeyInput = screen.getByTestId('api-key-input');
    expect(apiKeyInput.dataset.model).toBe('gemini-2.5-flash');
  });

  it('API 설정 패널에 구버전 2.0 Flash가 전달되어서는 안 된다', () => {
    render(<DocumentComparator />);
    const apiKeyInput = screen.getByTestId('api-key-input');
    expect(apiKeyInput.dataset.model).not.toBe('gemini-2.0-flash');
  });

  it('localStorage에 저장된 모델이 있으면 해당 모델을 사용해야 한다', () => {
    localStorageMock.setItem('gemini_api_key', 'test-key');
    localStorageMock.setItem('gemini_model', 'gemini-2.5-pro');
    render(<DocumentComparator />);
    // API 키가 있으면 설정 패널은 숨겨지고 상태 바가 표시됨
    expect(screen.queryByTestId('api-key-input')).not.toBeInTheDocument();
  });

  it('localStorage에 모델이 없으면 2.5 Flash가 기본값이어야 한다', () => {
    // 모델 없이 API 키만 있는 경우
    localStorageMock.setItem('gemini_api_key', 'test-key');
    // gemini_model은 저장하지 않음
    render(<DocumentComparator />);
    // 연결됨 상태에서 Flash 표시명 확인
    expect(screen.getByText(/Gemini 2\.5 Flash/)).toBeInTheDocument();
  });
});

describe('DocumentComparator — 모델 표시명', () => {
  it('Flash 모델일 때 "Gemini 2.5 Flash"가 표시되어야 한다', () => {
    localStorageMock.setItem('gemini_api_key', 'test-key');
    localStorageMock.setItem('gemini_model', 'gemini-2.5-flash');
    render(<DocumentComparator />);
    expect(screen.getByText('Gemini 2.5 Flash')).toBeInTheDocument();
  });

  it('Pro 모델일 때 "Gemini 2.5 Pro"가 표시되어야 한다', () => {
    localStorageMock.setItem('gemini_api_key', 'test-key');
    localStorageMock.setItem('gemini_model', 'gemini-2.5-pro');
    render(<DocumentComparator />);
    expect(screen.getByText('Gemini 2.5 Pro')).toBeInTheDocument();
  });
});
