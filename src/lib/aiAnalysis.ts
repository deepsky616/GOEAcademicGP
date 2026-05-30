import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { ResponseSchema } from '@google/generative-ai';
import { BASELINE_ARTICLES, getArticleKey } from './baselineData';

export interface ArticleFinding {
  article: string;
  articleTitle: string;
  errorType: '누락' | '오류' | '부족';
  errorContent: string;
  suggestion: string;
}

export interface AIAnalysisResult {
  articleId: string;
  articleTitle: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  analysis: string;
  suggestion?: string;
}

export interface ComparisonResult {
  schoolName?: string;
  model?: string;
  analyzedAt: string;
  summary: string;
  findings: ArticleFinding[];
  articles: AIAnalysisResult[];
  recommendations: string[];
}

const ARTICLE_FINDINGS_SCHEMA: ResponseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      article: {
        type: SchemaType.STRING,
        description: '예: 제9조',
      },
      articleTitle: {
        type: SchemaType.STRING,
        description: '예: 평가 운영',
      },
      errorType: {
        type: SchemaType.STRING,
        format: 'enum',
        enum: ['누락', '오류', '부족'],
      },
      errorContent: {
        type: SchemaType.STRING,
      },
      suggestion: {
        type: SchemaType.STRING,
      },
    },
    required: ['article', 'articleTitle', 'errorType', 'errorContent', 'suggestion'],
  },
};

function buildAnalysisPrompt(schoolRegulationText: string): string {
  let baselineSummary = '【학업성적관리규정 기준 (예시안) 조문】\n';
  for (const article of BASELINE_ARTICLES) {
    const key = getArticleKey(article);
    baselineSummary += `[${key}] ${article.title}\n${article.content}\n\n`;
  }

  const uploadedContent = '【분석 대상 학교 규정】\n' + schoolRegulationText;

  const analysisInstructions = `위 두 문서를 비교하여 학교 규정이 예시안(기준)과 어떻게 다른지 분석해주세요.

**비교 분석 시 반드시 확인해야 할 항목:**
1. **누락된 내용**: 예시안에 있는 내용이 학교 규정에서 아예 빠져있는 경우
2. **오류 내용**: 예시안에 비해 잘못되거나 변경된 내용
3. **부족한 부분**: 예시안의 필수 항목이 불완전하게 작성된 경우

**출력 형식:**
JSON 배열로만 답해주세요. 배열의 각 항목은 article, articleTitle, errorType, errorContent, suggestion 필드를 가져야 합니다.
errorType은 "누락", "오류", "부족" 중 하나만 사용하세요.

**주의사항:**
1. 예시안의 각 조문을 기준으로 학교 규정을 하나씩 비교해주세요
2. 누락된 내용은 errorType "누락", 변경되었거나 잘못 적힌 내용은 "오류", 불완전한 내용은 "부족"으로 표시해주세요
3. errorContent에는 실제 학교 규정의 문제 원문을 포함해주세요
4. suggestion에는 예시안에 맞는 구체적인 정정 내용을 작성해주세요
5. 문제가 없는 조문은 배열에 넣지 마세요
6. 한국어로 작성해주세요
7. **1안/2안 선택 규칙**: 예시안에 (1안), (2안) 등 선택지가 있는 경우, 학교에서 하나만 선택하면 정상입니다. 아무 것도 선택하지 않았거나 예시안에 없는 내용이 작성된 경우에만 오류로 판정해주세요`;

  return baselineSummary + '\n' + uploadedContent + '\n' + analysisInstructions;
}

function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function toArticleFindings(value: unknown): ArticleFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): ArticleFinding[] => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const record = item as Record<string, unknown>;
    const errorType = record.errorType;
    if (errorType !== '누락' && errorType !== '오류' && errorType !== '부족') {
      return [];
    }

    const article = typeof record.article === 'string' ? record.article.trim() : '';
    const articleTitle = typeof record.articleTitle === 'string' ? record.articleTitle.trim() : '';
    const errorContent = typeof record.errorContent === 'string' ? record.errorContent.trim() : '';
    const suggestion = typeof record.suggestion === 'string' ? record.suggestion.trim() : '';

    if (!article || !errorContent || !suggestion) {
      return [];
    }

    return [{
      article,
      articleTitle,
      errorType,
      errorContent,
      suggestion,
    }];
  });
}

function parseFindingsFromResponse(fullResponse: string): ArticleFinding[] {
  try {
    return toArticleFindings(JSON.parse(stripJsonCodeFence(fullResponse)));
  } catch {
    return [];
  }
}

export async function analyzeWithAI(
  apiKey: string,
  schoolRegulationText: string,
  model: string = 'gemini-2.5-flash',
  onProgress?: (progress: number, status?: string) => void
): Promise<ComparisonResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: ARTICLE_FINDINGS_SCHEMA,
    },
  });

  onProgress?.(10, '프롬프트 생성 중...');

  const prompt = buildAnalysisPrompt(schoolRegulationText);

  onProgress?.(30, 'AI 분석 시작...');

  try {
    const result = await genModel.generateContentStream(prompt);

    let fullResponse = '';
    let chunkCount = 0;

    onProgress?.(40, 'AI 분석 중...');

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullResponse += chunkText;
      chunkCount++;

      const streamingProgress = Math.min(85, 40 + Math.floor(chunkCount * 3));
      onProgress?.(streamingProgress, 'AI 분석 중... ' + chunkCount + ' chunks');
    }

    onProgress?.(90, '응답 처리 중...');

    const comparisonResult: ComparisonResult = {
      model,
      analyzedAt: new Date().toISOString(),
      summary: fullResponse,
      findings: parseFindingsFromResponse(fullResponse),
      articles: [],
      recommendations: [],
    };

    onProgress?.(100, '분석 완료!');

    return comparisonResult;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    throw new Error(message);
  }
}

export function extractSchoolName(text: string): string | undefined {
  const patterns = [
    /(?:^|[^가-힣])([가-힣]{2,10}초등학교)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return undefined;
}
