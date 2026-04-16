import { GoogleGenerativeAI } from '@google/generative-ai';
import { BASELINE_ARTICLES, getArticleKey } from './baselineData';

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
  articles: AIAnalysisResult[];
  recommendations: string[];
}

function buildAnalysisPrompt(schoolRegulationText: string): string {
  let baselineSummary = '【학업성적관리규정 기준 (예시안) 조문】\n';
  for (const article of BASELINE_ARTICLES) {
    const key = getArticleKey(article);
    baselineSummary += `[${key}] ${article.title}\n${article.content}\n\n`;
  }

  let uploadedContent = '【분석 대상 학교 규정】\n' + schoolRegulationText;

  const prompt = `${baselineSummary}

${uploadedContent}

위 두 문서를 비교하여 학교 규정이 예시안(기준)과 어떻게 다른지 분석해주세요.

**출력 형식 (반드시 이 형식을 지켜주세요):**

## [제X조] (제목)
**오류 내용:** [예시안에 비해 무엇이 잘못되었는지, 누락되었는지, 또는 변경되었는지 구체적으로 작성]
**수정 제안:** [왜 문제가 되는지 + 어떻게 수정해야 하는지 구체적으로 작성]

## [제X조] (제목)  
**오류 내용:** [구체적으로 작성]
**수정 제안:** [구체적으로 작성]

---

**주의사항:**
1. 오류 내용에는 실제 규정에서 잘못된 부분의 **원문**을 포함해주세요
2. 수정 제안에는 예시안에 맞는 **정정 내용**을 구체적으로 작성해주세요
3. 문제가 없는 조문은 작성하지 않아도 됩니다
4. 한국어로 작성해주세요

이제 분석을 시작합니다:`;

  return prompt;
}

export async function analyzeWithAI(
  apiKey: string,
  schoolRegulationText: string,
  model: string = 'gemini-2.0-flash',
  onProgress?: (progress: number) => void
): Promise<ComparisonResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const selectedModel = genAI.getGenerativeModel({ model });

  onProgress?.(10);

  const prompt = buildAnalysisPrompt(schoolRegulationText);

  onProgress?.(30);

  const result = await selectedModel.generateContent(prompt);
  const response = result.response;
  const analysisText = response.text();

  onProgress?.(80);

  const comparisonResult: ComparisonResult = {
    model,
    analyzedAt: new Date().toISOString(),
    summary: analysisText,
    articles: [],
    recommendations: [],
  };

  onProgress?.(100);

  return comparisonResult;
}

export function extractSchoolName(text: string): string | undefined {
  const patterns = [
    /(\d+초등학교)\s*학업성적관리규정/,
    /(\d+초등학교)/,
    /(.*초등학교)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}