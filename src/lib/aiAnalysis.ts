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
  analyzedAt: string;
  summary: string;
  articles: AIAnalysisResult[];
  recommendations: string[];
}

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\u00A0\u3000]/g, ' ')
    .trim();
}

function extractArticlesFromText(text: string): Map<string, { title: string; content: string }> {
  const articles = new Map();
  const lines = text.split('\n');
  let currentArticle: string | null = null;
  let currentTitle = '';
  let currentContent: string[] = [];

  const articlePattern = /^제(\d+)조(?:[\(『])([^(『)]+)?[\)』]?/;
  const subArticlePattern = /^제(\d+)조의?\d?\s*[\(『]([^(『)]+)[\)』]?/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const mainMatch = trimmed.match(articlePattern);
    const subMatch = trimmed.match(subArticlePattern);

    if (mainMatch) {
      if (currentArticle) {
        articles.set(currentArticle, {
          title: currentTitle,
          content: currentContent.join('\n').trim()
        });
      }
      currentArticle = `제${mainMatch[1]}조`;
      currentTitle = mainMatch[2] || '';
      currentContent = [trimmed.replace(articlePattern, '').trim()];
    } else if (subMatch && currentArticle) {
      if (currentArticle) {
        articles.set(currentArticle, {
          title: currentTitle,
          content: currentContent.join('\n').trim()
        });
      }
      currentArticle = `제${subMatch[1]}조`;
      currentTitle = subMatch[2] || '';
      currentContent = [trimmed.replace(subArticlePattern, '').trim()];
    } else if (currentArticle) {
      currentContent.push(trimmed);
    }
  }

  if (currentArticle) {
    articles.set(currentArticle, {
      title: currentTitle,
      content: currentContent.join('\n').trim()
    });
  }

  return articles;
}

function buildAnalysisPrompt(schoolRegulationText: string): string {
  const uploadedArticles = extractArticlesFromText(schoolRegulationText);

  let baselineSummary = '【기준 예시안 조문】\n';
  for (const article of BASELINE_ARTICLES) {
    const key = getArticleKey(article);
    baselineSummary += `${key} ${article.title}:\n${article.content}\n\n`;
  }

  let uploadedSummary = '【분석 대상 학교 규정】\n';
  for (const [key, data] of uploadedArticles) {
    uploadedSummary += `${key} ${data.title}:\n${data.content}\n\n`;
  }

  const prompt = `${baselineSummary}

${uploadedSummary}

위 두 문서를 비교하여 다음 형식으로 분석해주세요:

## 비교 분석 결과

### 1. 요약
- 학교 규정과 예시안의 전반적 차이점

### 2. 조문별 분석
각 조문에 대해 다음을 분석:
- **제X조 [삭제]**: 예시안에 있지만 학교 규정에 없거나大幅変更된 경우
- **제X조 [추가]**: 학교 규정에만 있는 새로운 조문
- **제X조 [수정]**: 의미가 변경된 조문
- **제X조 [동일]**: 예시안과 동일한 경우

### 3. 수정/삭제된 조문의 상세 분석
- 무엇이 변경되었는지
- 변경이 적절한지 여부
- 개선 제안사항

### 4. 종합 추천
- 학교 규정 작성 시 추가하면 좋은 항목
- 주의해야 할 점

한국어로 답변해주세요.`;

  return prompt;
}

export async function analyzeWithAI(
  apiKey: string,
  schoolRegulationText: string,
  onProgress?: (progress: number) => void
): Promise<ComparisonResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

  onProgress?.(10);

  const prompt = buildAnalysisPrompt(schoolRegulationText);

  onProgress?.(30);

  const result = await model.generateContent(prompt);
  const response = result.response;
  const analysisText = response.text();

  onProgress?.(80);

  const comparisonResult: ComparisonResult = {
    analyzedAt: new Date().toISOString(),
    summary: extractSummary(analysisText),
    articles: extractArticleAnalysis(analysisText),
    recommendations: extractRecommendations(analysisText),
  };

  onProgress?.(100);

  return comparisonResult;
}

function extractSummary(text: string): string {
  const match = text.match(/### 1\. 요약[\s\S]*?(?=###|$)/i);
  if (match) {
    return match[0].replace(/### 1\. 요약[\s\S]*?:\s*/, '').trim();
  }
  return '분석이 완료되었습니다.';
}

function extractArticleAnalysis(text: string): AIAnalysisResult[] {
  const results: AIAnalysisResult[] = [];
  const articleMatches = text.matchAll(/(제\d+조[^:\n]*):?\s*\[(삭제|추가|수정|동일)\]/g);

  for (const match of articleMatches) {
    const articleId = match[1].replace(/제/, 'art').replace(/조.*/, '조');
    results.push({
      articleId,
      articleTitle: match[1],
      status: match[2] as 'added' | 'removed' | 'modified' | 'unchanged',
      analysis: extractArticleAnalysisDetail(text, match[1]),
    });
  }

  return results;
}

function extractArticleAnalysisDetail(text: string, articleTitle: string): string {
  const regex = new RegExp(`${articleTitle}[^\\n]*\\n([\\s\\S]*?)(?=제\\d+조|$)`, 'i');
  const match = text.match(regex);
  if (match) {
    return match[1].trim().slice(0, 500);
  }
  return '';
}

function extractRecommendations(text: string): string[] {
  const recommendations: string[] = [];
  const match = text.match(/### 4\. 종합 추천[\s\S]*?(?=###|$)/i);
  if (match) {
    const lines = match[0].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
        recommendations.push(trimmed.replace(/^[-•]\s*/, ''));
      }
    }
  }
  return recommendations;
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