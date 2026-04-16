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
  let baselineSummary = '【학업성적관리규정 기준 (예시안)】\n\n';
  for (const article of BASELINE_ARTICLES) {
    const key = getArticleKey(article);
    baselineSummary += `[${key}] ${article.title}\n${article.content}\n\n`;
  }

  const uploadedContent = '【분석 대상 학교 규정】\n\n' + schoolRegulationText;

  const systemInstruction = `당신은 학업성적관리규정 전문가입니다. 예시안과 학교 규정을严格按照 비교하여 누락된 항목을検出합니다.

**핵심 원칙:**
1. 예시안의 각 조, 각 항목을 빠짐없이 비교
2. 누락된 항목은 예시안의原文 그대로 표시
3. 오류는 "예시안 vs 학교규정" 명확히 비교
4. 분석 결과는 언제나 동일한 구조로 출력`;

  const analysisInstructions = `**Task: 예시안 대비 누락/오류 분석**

**비교 기준:** 위 예시안의 모든 조(제1조~제19조, 부칙)의 각 항(①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭)이 학교 규정에서 빠졌거나 잘못되었는지 확인

**출력 형식 (엄격히 준수):**

## [제X조] (제목)
- **유형:** 누락 / 오류 / 부족
- **누락항목:** (해당하는 경우) "예시안 제X조 X항"
- **오류내용:** "예시안: [정확한 내용] / 학교규정: [잘못된 내용]"
- **수정제안:** "예시안 제X조 X항 그대로 적용"

---
**출력 예시:**

## [제2조] (기본방침)
- **유형:** 누락
- **누락항목:** "예시안 제2조 ⑦항"
- **오류내용:** "예시안에 '학교생활기록부 작성에 필요한 창의적 체험활동상황, 일상생활 활동상황, 행동특성 및 종합의견의 누가기록은 (1안) 한다. (2안) 하지 않는다.'가 없음"
- **수정제안:** "⑦학교생활기록부 작성에 필요한 창의적 체험활동상황, 일상생활 활동상황, 행동특성 및 종합의견의 누가기록은 (1안) 한다. (2안) 하지 않는다."

---

**누락 분석 시 중요 규칙:**
- 예시안의 모든 조의 모든 항목을 확인
- 빠진 항목이 있으면 "누락항목"에 예시안의原文 기재
- "수정제안"에는 예시안의原文 그대로 작성`;

  return systemInstruction + '\n\n' + baselineSummary + '\n' + uploadedContent + '\n\n' + analysisInstructions;
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

  onProgress?.(30, 'AI 분석 시작...');

  try {
    const result = await genModel.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 8192,
      },
    });

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