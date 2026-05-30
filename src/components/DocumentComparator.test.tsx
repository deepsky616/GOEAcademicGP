import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DocumentComparator, { reconstructPageText } from './DocumentComparator';
import { analyzeWithAI, extractSchoolName } from '@/lib/aiAnalysis';

const hwpxMocks = vi.hoisted(() => ({
  createFromPlainText: vi.fn(),
}));

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

vi.mock('@ssabrojs/hwpxjs', () => {
  class MockHwpEncryptedError extends Error {}
  class MockHwpInvalidFormatError extends Error {}
  class MockHwpUnsupportedError extends Error {}

  return {
    HwpEncryptedError: MockHwpEncryptedError,
    HwpInvalidFormatError: MockHwpInvalidFormatError,
    HwpUnsupportedError: MockHwpUnsupportedError,
    hwpToText: vi.fn().mockResolvedValue('행복초등학교 학업성적관리규정 제1조'),
    HwpxReader: vi.fn(),
    HwpxWriter: vi.fn().mockImplementation(function MockHwpxWriter() {
      return {
      createFromPlainText: hwpxMocks.createFromPlainText,
      };
    }),
  };
});

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

Object.defineProperty(URL, 'createObjectURL', {
  value: vi.fn(() => 'blob:mock'),
  writable: true,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  value: vi.fn(),
  writable: true,
});

describe('PDF 텍스트 복원', () => {
  it('좌표가 섞인 텍스트 조각을 줄과 x 좌표 순서대로 복원해야 한다', () => {
    const text = reconstructPageText([
      { str: '나항', transform: [1, 0, 0, 1, 80, 680], width: 20, height: 10, hasEOL: false },
      { str: '제2조', transform: [1, 0, 0, 1, 20, 680], width: 25, height: 10, hasEOL: false },
      { str: '가항', transform: [1, 0, 0, 1, 80, 700], width: 20, height: 10, hasEOL: false },
      { str: '제1조', transform: [1, 0, 0, 1, 20, 700], width: 25, height: 10, hasEOL: false },
    ]);

    expect(text).toBe('제1조\t가항\n제2조\t나항');
  });

  it('hasEOL이 있으면 같은 y 좌표라도 다음 줄로 분리해야 한다', () => {
    const text = reconstructPageText([
      { str: '첫 줄', transform: [1, 0, 0, 1, 20, 700], width: 25, height: 10, hasEOL: true },
      { str: '둘째 줄', transform: [1, 0, 0, 1, 20, 700], width: 30, height: 10, hasEOL: false },
    ]);

    expect(text).toBe('첫 줄\n둘째 줄');
  });
});

describe('DocumentComparator — 기본 모델 상태', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

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

describe('DocumentComparator — 구조화 분석 결과', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    hwpxMocks.createFromPlainText.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it('findings를 오류 표 항목으로 직접 표시해야 한다', async () => {
    localStorageMock.setItem('gemini_api_key', 'test-key');
    vi.mocked(extractSchoolName).mockReturnValue('행복초등학교');
    vi.mocked(analyzeWithAI).mockResolvedValue({
      model: 'gemini-2.5-flash',
      analyzedAt: '2026-05-30T00:00:00.000Z',
      summary: '[]',
      findings: [
        {
          article: '제9조',
          articleTitle: '평가 운영',
          errorType: '부족',
          errorContent: '평가 계획 안내 내용이 일부만 작성됨',
          suggestion: '예시안에 맞게 평가 계획 안내 절차를 구체적으로 보완',
        },
      ],
      articles: [],
      recommendations: [],
    });

    const { container } = render(<DocumentComparator />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(['mock'], 'sample.hwp', { type: 'application/x-hwp' });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 분석 시작' }));

    await waitFor(() => {
      expect(screen.getByText('제9조')).toBeInTheDocument();
    });
    expect(screen.getByText('부족')).toBeInTheDocument();
    expect(screen.getByText('평가 계획 안내 내용이 일부만 작성됨')).toBeInTheDocument();
    expect(screen.getByText('예시안에 맞게 평가 계획 안내 절차를 구체적으로 보완')).toBeInTheDocument();
  });

  it('HWPX 저장 버튼은 HWPX Blob 다운로드를 트리거해야 한다', async () => {
    localStorageMock.setItem('gemini_api_key', 'test-key');
    vi.mocked(extractSchoolName).mockReturnValue('행복초등학교');
    vi.mocked(analyzeWithAI).mockResolvedValue({
      model: 'gemini-2.5-flash',
      analyzedAt: '2026-05-30T00:00:00.000Z',
      summary: '[]',
      findings: [
        {
          article: '제9조',
          articleTitle: '평가 운영',
          errorType: '오류',
          errorContent: '잘못된 평가 문구',
          suggestion: '평가 문구를 정정',
        },
      ],
      articles: [],
      recommendations: [],
    });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { container } = render(<DocumentComparator />);
    const input = container.querySelector('input[type="file"]');
    const file = new File(['mock'], 'sample.hwp', { type: 'application/x-hwp' });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 분석 시작' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'HWPX로 저장' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'HWPX로 저장' }));

    await waitFor(() => {
      expect(hwpxMocks.createFromPlainText).toHaveBeenCalled();
    });
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
