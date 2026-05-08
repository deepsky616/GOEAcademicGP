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
1. **누락된 내용**: 예시안에 있는 내용이 학교 규정에서 아예 빠져있는 경우
2. **오류 내용**: 예시안에 비해 잘못되거나 변경된 내용
3. **부족한 부분**: 예시안의 필수 항목이 불완전하게 작성된 경우

**출력 형식 (반드시 이 형식을 지켜주세요):**

## [제X조] (제목)
**누락/오류 유형:** [누락 / 오류 / 부족] 중 해당 유형
**오류 내용:** [구체적으로 작성 - 누락의 경우 "○○ 조문의 ○○ 부분이 누락됨", 오류의 경우 실제 잘못된 부분의 원문]
**수정 제안:** [왜 문제가 되는지 + 예시안에 맞게 어떻게 수정해야 하는지 구체적으로 작성]

## [제X조] (제목)
**누락/오류 유형:** [구체적으로 작성]
**오류 내용:** [구체적으로 작성]
**수정 제안:** [구체적으로 작성]

---

**주의사항:**
1. 예시안의 각 조문을 기준으로 학교 규정을 하나씩 비교해주세요
2. 누락된 내용이 있으면 반드시 "누락" 유형으로 표시하고 어떤 내용이 누락되었는지 명시해주세요
3. 오류 내용에는 실제 규정에서 잘못된 부분의 **원문**을 포함해주세요
4. 수정 제안에는 예시안에 맞는 **정정 내용**을 구체적으로 작성해주세요
5. 문제가 없는 조문은 작성하지 않아도 됩니다
6. 한국어로 작성해주세요
7. **1안/2안 선택 사항**: 예시안에 (1안), (2안)等形式이 있는 경우, 학교에서 **하나를 선택**하면 정상입니다. 선택된 항목이 없거나 다른 내용이 작성된 경우에만 오류로 판정해주세요`;

  return baselineSummary + '\n' + uploadedContent + '\n' + analysisInstructions;
}

export async function analyzeWithAI(
  apiKey: string,
  schoolRegulationText: string,
  model: string = 'gemini-2.5-flash-preview-0520',
  onProgress?: (progress: number, status?: string) => void
): Promise<ComparisonResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model });

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