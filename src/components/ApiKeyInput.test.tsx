import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ApiKeyInput from './ApiKeyInput';

// Gemini SDK mock
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(),
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

const noop = () => {};

describe('ApiKeyInput — 모델 목록', () => {
  beforeEach(() => localStorageMock.clear());

  it('Gemini 2.5 Flash 옵션이 렌더링되어야 한다', () => {
    render(<ApiKeyInput onApiKeySet={noop} />);
    expect(screen.getByText('Gemini 2.5 Flash')).toBeInTheDocument();
  });

  it('Gemini 2.5 Pro 옵션이 렌더링되어야 한다', () => {
    render(<ApiKeyInput onApiKeySet={noop} />);
    expect(screen.getByText('Gemini 2.5 Pro')).toBeInTheDocument();
  });

  it('Gemini 2.0 Flash 옵션이 존재하면 안 된다', () => {
    render(<ApiKeyInput onApiKeySet={noop} />);
    expect(screen.queryByText('Gemini 2.0 Flash')).not.toBeInTheDocument();
  });

  it('기본 선택 모델은 Gemini 2.5 Flash이어야 한다', () => {
    render(<ApiKeyInput onApiKeySet={noop} />);
    const radios = screen.getAllByRole('radio');
    // 첫 번째 라디오(Flash)가 기본 선택
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
  });

  it('Flash 라디오 버튼의 value가 gemini-2.5-flash-preview-05-20이어야 한다', () => {
    render(<ApiKeyInput onApiKeySet={noop} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0].getAttribute('value')).toBe('gemini-2.5-flash-preview-05-20');
  });

  it('Pro 라디오 버튼의 value가 gemini-2.5-pro-preview-0520이어야 한다', () => {
    render(<ApiKeyInput onApiKeySet={noop} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[1].getAttribute('value')).toBe('gemini-2.5-pro-preview-0520');
  });

  it('Flash 옵션에 "권장" 배지가 표시되어야 한다', () => {
    render(<ApiKeyInput onApiKeySet={noop} />);
    expect(screen.getByText('권장')).toBeInTheDocument();
  });
});

describe('ApiKeyInput — 모델 2개만 존재', () => {
  it('라디오 버튼은 정확히 2개여야 한다', () => {
    render(<ApiKeyInput onApiKeySet={noop} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
  });
});
