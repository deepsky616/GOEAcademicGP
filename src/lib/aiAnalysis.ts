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

  const uploadedContent = '【분석 대상 학교 규정】\n' + schoolRegulationText;

  const analysisInstructions = `위 두 문서를 비교하여 학교 규정이 예시안(기준)과 어떻게 다른지 분석해주세요.

**비교 분석 시 반드시 확인해야 할 항목:**
1. **누락**: 예시안에 있는 항목이 학교 규정에서 아예 빠져있는 경우
2. **오류**: 예시안에 비해 잘못되거나 변경된 경우
3. **부족**: 필수 항목이 불완전하게 작성된 경우

**출력 형식 (엄격히 준수):**

## [제X조] (제목)
**유형:** [누락/오류/부족]
**내용:** [한 줄로 요약 - 누락은 "제X조 X항 누락", 오류는 "예시안: OOO / 학교: XXX"]
**수정:** [예시안 조항 그대로 복사]

---
**출력 예시:**

## [제2조] (기본방침)
**유형:** 누락
**내용:** 제2조 ⑦항의 누락 - 예시안에 '학교생활기록부 작성에 필요한 창의적 체험활동상황, 일상생활 활동상황, 행동특성 및 종합의견의 누가기록은 (1안) 한다. (2안) 하지 않는다.'가 없음
**수정:** ⑦학교생활기록부 작성에 필요한 창의적 체험활동상황, 일상생활 활동상황, 행동특성 및 종합의견의 누가기록은 (1안) 한다. (2안) 하지 않는다.

---

**주의사항:**
1. 예시안 각 조의 모든 항(①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭)이 있는지 확인
2. 누락 시 빠진 항 번호와 내용을 정확히 명시
3. 오류 시 예시안vs학교규정 비교를 한 줄로 명확히 작성
4. **수정 제안은 반드시 예시안原文 그대로 작성** (변경 없이 복사)
5. 문제 없는 조문은 생략
6. 동일 파일 반복 분석 시 항상 동일한 결과 출력`;

  return baselineSummary + '\n' + uploadedContent + '\n' + analysisInstructions;
}

export async function analyzeWithAI(
  apiKey: string,
  schoolRegulationText: string,
  model: string = 'gemini-2.0-flash',
  onProgress?: (progress: number, status?: string) => void
): Promise<ComparisonResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model });

  onProgress?.(10, '프롬프트 생성 중...');

  const prompt = buildAnalysisPrompt(schoolRegulationText);

  onProgress?.(30, 'AI 분석 중...');

  try {
    const result = await genModel.generateContent(prompt);
    const fullResponse = result.response.text();

    onProgress?.(90, '응답 처리 중...');

    const comparisonResult: ComparisonResult = {
      model,
      analyzedAt: new Date().toISOString(),
      summary: fullResponse,
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