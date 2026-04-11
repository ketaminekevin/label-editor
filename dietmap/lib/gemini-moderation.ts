import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction:
    'You are a content moderation assistant. Always respond with raw JSON only — no markdown, no code fences, no explanation.',
});

async function callGemini(prompt: string): Promise<unknown> {
  const result = await model.generateContent(prompt);
  const text = result.response.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? '')
    .join('') ?? '';
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  try { return JSON.parse(cleaned); }
  catch { throw new Error(`Gemini returned non-JSON: ${cleaned.slice(0, 200)}`); }
}

// ── System 1: verify a new restaurant submission ──────────────────────────────

export interface SubmissionVerdict {
  verdict: 'approve' | 'review' | 'reject';
  confidence: number; // 0–100
  reasons: string[];
}

export async function verifyRestaurantSubmission(data: {
  name: string;
  address: string;
  cuisine_type?: string[];
  dietary_tags?: string[];
  description?: string;
}): Promise<SubmissionVerdict> {
  const prompt = `You are moderating a user-submitted restaurant listing for a dietary-safety app.

SUBMISSION:
Name: ${data.name}
Address: ${data.address}
Cuisine: ${(data.cuisine_type ?? []).join(', ') || 'not specified'}
Dietary tags: ${(data.dietary_tags ?? []).join(', ') || 'none'}
Description: ${data.description || 'none'}

Assess whether this is a legitimate restaurant listing. Consider:
- Does the name look like a real business name? Short, quirky, or single-word names are completely normal for cafes and restaurants — do not flag these.
- Does the address look like a real street address (not "123 fake st" or random text)? Partial addresses or addresses without a country are fine.
- Are the dietary tags plausible for the cuisine type?
- Any clear signs of spam, offensive content, or deliberate manipulation?

Respond with ONLY this JSON:
{
  "verdict": "approve" | "review" | "reject",
  "confidence": 0-100,
  "reasons": ["reason 1", "reason 2"]
}

Guidelines:
- approve (confidence 80–100): looks like a real place — give benefit of the doubt for unusual names or incomplete details
- review (confidence 40–79): something genuinely suspicious, e.g. address looks fake or name is gibberish
- reject (confidence 0–39): obvious spam, offensive content, or clearly not a restaurant listing`;

  try {
    const raw = await callGemini(prompt) as Partial<SubmissionVerdict>;
    return {
      verdict: ['approve', 'review', 'reject'].includes(raw.verdict ?? '')
        ? raw.verdict!
        : 'review',
      confidence: typeof raw.confidence === 'number'
        ? Math.min(100, Math.max(0, raw.confidence))
        : 50,
      reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
    };
  } catch {
    // On AI failure, default to review so a human sees it
    return { verdict: 'review', confidence: 50, reasons: ['AI check unavailable — manual review required'] };
  }
}

// ── System 2: screen a new review submission ─────────────────────────────────

export interface ReviewScreenResult {
  action: 'approve' | 'flag' | 'remove';
  confidence: number;
  summary: string;
}

export async function screenReview(
  review: { body: string; rating: number; restaurant_name: string; dietary_tags?: string[] },
): Promise<ReviewScreenResult> {
  const prompt = `You are moderating a user-submitted review on a dietary-safety restaurant app.

REVIEW:
Restaurant: ${review.restaurant_name}
Rating: ${review.rating}/5
Content: ${review.body}
Dietary tags mentioned: ${review.dietary_tags?.join(', ') || 'none'}

Check for:
- Spam, gibberish, or clearly fake content
- Offensive or abusive language
- Dangerous or deliberately false dietary/allergen claims (e.g. claiming something is gluten-free when it obviously isn't)
- Genuine-sounding review with no issues

Respond with ONLY this JSON:
{
  "action": "approve" | "flag" | "remove",
  "confidence": 0-100,
  "summary": "One-line note for admin (max 100 chars)"
}

Guidelines:
- approve: genuine review, no concerns
- flag: minor concern, needs human glance (e.g. vague, borderline dietary claim)
- remove: clear spam, offensive, or dangerously false dietary info`;

  try {
    const raw = await callGemini(prompt) as Partial<ReviewScreenResult>;
    return {
      action: ['approve', 'flag', 'remove'].includes(raw.action ?? '') ? raw.action! : 'approve',
      confidence: typeof raw.confidence === 'number' ? Math.min(100, Math.max(0, raw.confidence)) : 80,
      summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 100) : 'Review accepted',
    };
  } catch {
    return { action: 'approve', confidence: 50, summary: 'AI screening unavailable — accepted by default' };
  }
}

// ── System 3: analyse a review report ────────────────────────────────────────

export interface ReviewReportAnalysis {
  credible: boolean;
  action: 'dismiss' | 'flag' | 'remove';
  confidence: number;
  summary: string;
}

export async function analyzeReviewReport(
  review: { body: string; rating: number | null; restaurant_name: string },
  report: { reason: string; detail?: string }
): Promise<ReviewReportAnalysis> {
  const prompt = `You are moderating a report against a user review on a dietary-safety restaurant app.

REVIEW:
Restaurant: ${review.restaurant_name}
Rating: ${review.rating ?? 'not specified'}/5
Content: ${review.body || 'no text'}

REPORT:
Reason: ${report.reason}
Detail: ${report.detail || 'none provided'}

Assess whether this report is credible and determine the appropriate action.

Respond with ONLY this JSON:
{
  "credible": true | false,
  "action": "dismiss" | "flag" | "remove",
  "confidence": 0-100,
  "summary": "One-line summary for admin (max 120 chars)"
}

Guidelines:
- dismiss: report is unfounded, vague, or the review seems genuine
- flag: credible concern needing human review (e.g. possibly fake or misleading dietary info)
- remove: clear violation (spam, offensive, dangerous false dietary claims)`;

  try {
    const raw = await callGemini(prompt) as Partial<ReviewReportAnalysis>;
    return {
      credible: Boolean(raw.credible),
      action: ['dismiss', 'flag', 'remove'].includes(raw.action ?? '') ? raw.action! : 'flag',
      confidence: typeof raw.confidence === 'number' ? Math.min(100, Math.max(0, raw.confidence)) : 50,
      summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 120) : 'Report requires review',
    };
  } catch {
    return { credible: true, action: 'flag', confidence: 50, summary: 'AI check unavailable — manual review required' };
  }
}

// ── System 3: analyse a restaurant report ────────────────────────────────────

export interface ReportAnalysis {
  credible: boolean;
  action: 'dismiss' | 'flag' | 'remove';
  confidence: number; // 0–100
  summary: string;
}

export async function analyzeReport(
  restaurant: { name: string; address: string; cuisine_type?: string[]; dietary_tags?: string[] },
  report: { reason: string; detail?: string }
): Promise<ReportAnalysis> {
  const prompt = `You are moderating a report submitted against a restaurant listing on a dietary-safety app.

RESTAURANT:
Name: ${restaurant.name}
Address: ${restaurant.address}
Cuisine: ${(restaurant.cuisine_type ?? []).join(', ') || 'not specified'}
Dietary tags: ${(restaurant.dietary_tags ?? []).join(', ') || 'none'}

REPORT:
Reason: ${report.reason}
Detail: ${report.detail || 'none provided'}

Assess how credible and serious this report is. Determine the appropriate action.

Respond with ONLY this JSON:
{
  "credible": true | false,
  "action": "dismiss" | "flag" | "remove",
  "confidence": 0-100,
  "summary": "One-line summary for admin (max 120 chars)"
}

Guidelines:
- dismiss: report appears unfounded, vague, or retaliatory
- flag: credible concern that needs admin review before action
- remove: clear violation (fake listing, offensive content, dangerous misinformation about allergens)`;

  try {
    const raw = await callGemini(prompt) as Partial<ReportAnalysis>;
    return {
      credible: Boolean(raw.credible),
      action: ['dismiss', 'flag', 'remove'].includes(raw.action ?? '')
        ? raw.action!
        : 'flag',
      confidence: typeof raw.confidence === 'number'
        ? Math.min(100, Math.max(0, raw.confidence))
        : 50,
      summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 120) : 'Report requires review',
    };
  } catch {
    return { credible: true, action: 'flag', confidence: 50, summary: 'AI check unavailable — manual review required' };
  }
}
