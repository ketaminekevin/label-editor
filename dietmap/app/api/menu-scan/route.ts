import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildMenuScanPrompt, parseMenuScanResponse } from '@/lib/menu-scanner';

export const maxDuration = 60;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json([], { status: 401 });

    const rows = await query<{
      id: string;
      restaurant_name: string | null;
      cuisine_type: string | null;
      dietary_tags: string[];
      detected_language: string;
      created_at: string;
      safe_count: number;
      options_count: number;
      risky_count: number;
      total_count: number;
    }>(
      `SELECT id, restaurant_name, cuisine_type, dietary_tags, detected_language, created_at,
              jsonb_array_length(COALESCE(ai_result->'safe',        '[]')) AS safe_count,
              jsonb_array_length(COALESCE(ai_result->'options',     '[]')) AS options_count,
              jsonb_array_length(COALESCE(ai_result->'risky',       '[]')) AS risky_count,
              jsonb_array_length(COALESCE(ai_result->'safe',        '[]')) +
              jsonb_array_length(COALESCE(ai_result->'options',     '[]')) +
              jsonb_array_length(COALESCE(ai_result->'risky',       '[]')) +
              jsonb_array_length(COALESCE(ai_result->'unidentified','[]')) AS total_count
       FROM menu_scans
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [session.user.id]
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('menu-scan GET error:', err);
    return NextResponse.json([], { status: 500 });
  }
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');
const FREE_MONTHLY_LIMIT = 3;

function monthStart() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.user.id;

    const userRows = await query<{ account_tier: string }>(
      `SELECT account_tier FROM users WHERE id = $1`, [userId]
    );
    const isPro = userRows[0]?.account_tier === 'pro';

    if (!isPro) {
      const usageRows = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM menu_scans WHERE user_id = $1 AND created_at >= $2`,
        [userId, monthStart()]
      );
      if ((usageRows[0]?.count ?? 0) >= FREE_MONTHLY_LIMIT) {
        return NextResponse.json(
          { error: 'You have used all 3 free menu scans this month.', upgrade: true },
          { status: 403 }
        );
      }
    }

    const body = await req.json() as {
      imageBase64: string;
      mimeType: string;
      dietaryTags?: string[];
    };
    const { imageBase64, mimeType, dietaryTags = [] } = body;

    if (!imageBase64 || !mimeType) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 });
    }

    const prompt = buildMenuScanPrompt(dietaryTags);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction:
        'You are a dietary safety expert and multilingual menu analyst. ' +
        'Always respond with raw JSON only — no markdown, no code fences, no explanation text.',
    });

    let textContent = '';
    let lastErr: Error | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await model.generateContent([
          { inlineData: { mimeType, data: imageBase64 } },
          { text: prompt },
        ]);
        textContent =
          result.response.candidates?.[0]?.content?.parts
            ?.map((p: { text?: string }) => p.text ?? '')
            .join('') ?? '';
        if (textContent.trim()) { lastErr = null; break; }
      } catch (err: unknown) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (!textContent.trim()) {
      throw lastErr ?? new Error('No response from AI');
    }

    const scanResult = parseMenuScanResponse(textContent);

    const scanRows = await query<{ id: string }>(
      `INSERT INTO menu_scans (user_id, detected_language, restaurant_name, cuisine_type, dietary_tags, ai_result)
       VALUES ($1, $2, $3, $4, $5::text[], $6) RETURNING id`,
      [userId, scanResult.detected_language, scanResult.restaurant_name ?? null, scanResult.cuisine_type ?? null, dietaryTags, JSON.stringify(scanResult)]
    );

    return NextResponse.json({ ...scanResult, id: scanRows[0]?.id });
  } catch (err) {
    console.error('menu-scan POST error:', err);
    const message = err instanceof Error ? err.message : 'Scan failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
