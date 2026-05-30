import { describe, it, expect, vi } from 'vitest';
import { extractSchoolName, analyzeWithAI } from './aiAnalysis';

const geminiMocks = vi.hoisted(() => ({
  getGenerativeModel: vi.fn(),
  generateContentStream: vi.fn(),
}));

// Gemini SDK mock — class 생성자로 mock
vi.mock('@google/generative-ai', () => {
  const mockStream = async function* () {
    yield {
      text: () => JSON.stringify([
        {
          article: '제1조',
          articleTitle: '목적',
          errorType: '누락',
          errorContent: '목적 조문 일부가 누락됨',
          suggestion: '예시안의 목적 조문을 반영해야 함',
        },
      ]),
    };
  };
  geminiMocks.generateContentStream.mockImplementation(() => Promise.resolve({ stream: mockStream() }));
  geminiMocks.getGenerativeModel.mockReturnValue({
    generateContentStream: geminiMocks.generateContentStream,
  });
  function MockGoogleGenerativeAI() {
    return { getGenerativeModel: geminiMocks.getGenerativeModel };
  }
  return {
    GoogleGenerativeAI: MockGoogleGenerativeAI,
    SchemaType: {
      STRING: 'string',
      NUMBER: 'number',
      INTEGER: 'integer',
      BOOLEAN: 'boolean',
      ARRAY: 'array',
      OBJECT: 'object',
    },
  };
});

// baselineData 'use client' 지시어 때문에 모듈 mock
vi.mock('./baselineData', () => ({
  BASELINE_ARTICLES: [
    { id: 'ch1-art1', chapter: 'ch1', articleNumber: 1, title: '목적', content: '목적 조문 내용' },
  ],
  getArticleKey: (article: { articleNumber: number; title: string }) => `제${article.articleNumber}조(${article.title})`,
}));

// ──────────────────────────────────────────
// 1. 기본 모델 ID가 2.5 Flash인지 검증
// ──────────────────────────────────────────
describe('analyzeWithAI 기본 모델', () => {
  it('기본 모델은 gemini-2.5-flash이어야 한다', async () => {
    const result = await analyzeWithAI('fake-api-key', '학교 규정 텍스트');
    // model 파라미터의 기본값이 반환된 결과에 포함되어야 함
    expect(result.model).toBe('gemini-2.5-flash');
  });

  it('구버전 gemini-2.0-flash를 기본 모델로 사용해서는 안 된다', async () => {
    const result = await analyzeWithAI('fake-api-key', '학교 규정 텍스트');
    expect(result.model).not.toBe('gemini-2.0-flash');
  });

  it('Pro 모델을 명시적으로 전달하면 해당 모델로 동작해야 한다', async () => {
    const result = await analyzeWithAI('fake-api-key', '학교 규정 텍스트', 'gemini-2.5-pro');
    expect(result.model).toBe('gemini-2.5-pro');
  });

  it('결과에 analyzedAt 타임스탬프가 있어야 한다', async () => {
    const result = await analyzeWithAI('fake-api-key', '학교 규정 텍스트');
    expect(result.analyzedAt).toBeTruthy();
    expect(new Date(result.analyzedAt).getTime()).not.toBeNaN();
  });

  it('구조화 JSON 응답을 findings에 담아야 한다', async () => {
    const result = await analyzeWithAI('fake-api-key', '학교 규정 텍스트');
    expect(result.findings).toEqual([
      {
        article: '제1조',
        articleTitle: '목적',
        errorType: '누락',
        errorContent: '목적 조문 일부가 누락됨',
        suggestion: '예시안의 목적 조문을 반영해야 함',
      },
    ]);
  });

  it('Gemini 구조화 출력 설정을 사용해야 한다', async () => {
    await analyzeWithAI('fake-api-key', '학교 규정 텍스트');
    expect(geminiMocks.getGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.5-flash',
      generationConfig: expect.objectContaining({
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      }),
    }));
  });
});

// ──────────────────────────────────────────
// 2. extractSchoolName 유틸 함수 검증
// ──────────────────────────────────────────
describe('extractSchoolName', () => {
  it('텍스트에서 초등학교 이름을 추출해야 한다', () => {
    const text = '이 규정은 행복초등학교 학업성적관리규정입니다.';
    expect(extractSchoolName(text)).toBe('행복초등학교');
  });

  it('두 글자 학교명도 추출할 수 있어야 한다', () => {
    const text = '강남초등학교 학업성적관리규정';
    expect(extractSchoolName(text)).toBe('강남초등학교');
  });

  it('초등학교가 없는 텍스트에서는 undefined를 반환해야 한다', () => {
    const text = '이 문서에는 학교 이름이 없습니다.';
    expect(extractSchoolName(text)).toBeUndefined();
  });

  it('텍스트 맨 앞에 있는 학교명도 추출해야 한다', () => {
    const text = '행복초등학교 학업성적관리규정 제1조';
    expect(extractSchoolName(text)).toBe('행복초등학교');
  });
});
