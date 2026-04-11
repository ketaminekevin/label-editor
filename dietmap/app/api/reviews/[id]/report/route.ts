import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { analyzeReviewReport } from '@/lib/gemini-moderation';

const VALID_REASONS = new Set([
  'spam', 'offensive', 'fake_review', 'incorrect_info', 'other',
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: reviewId } = await params;
  const { reason, detail } = await req.json() as { reason: string; detail?: string };

  if (!reason || !VALID_REASONS.has(reason)) {
    return NextResponse.json({ error: 'Valid reason required' }, { status: 400 });
  }

  // Fetch the review + restaurant name for AI context
  const reviewRows = await query<{
    id: string; body: string; rating: number | null; restaurant_name: string;
  }>(
    `SELECT rv.id, rv.body, rv.rating, r.name AS restaurant_name
     FROM reviews rv JOIN restaurants r ON r.id = rv.restaurant_id
     WHERE rv.id = $1`,
    [reviewId]
  );
  if (!reviewRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const rev = reviewRows[0];

  // ── Step 1: Insert report immediately ─────────────────────────────────────
  const rrRows = await query<{ id: string }>(
    `INSERT INTO review_reports (review_id, user_id, reason, detail) VALUES ($1, $2, $3, $4) RETURNING id`,
    [reviewId, session.user.id, reason, detail ?? null]
  );
  const rrId = rrRows[0]?.id ?? null;

  await query(
    `UPDATE reviews SET report_count = COALESCE(report_count, 0) + 1 WHERE id = $1`,
    [reviewId]
  );

  // ── Step 2: Log immediately ────────────────────────────────────────────────
  await query(
    `INSERT INTO activity_log (admin_id, action, target_type, target_id, detail, reference_id, stage)
     VALUES ($1, $2, 'review', $3, $4, $5, 'received')`,
    [session.user.id, 'review_reported', reviewId,
     `Review by "${rev.restaurant_name}" reported for "${reason}"${detail ? `: ${detail}` : ''}. AI review pending…`,
     rrId]
  ).catch(() => {});

  // ── Step 3: AI reviewing ───────────────────────────────────────────────────
  await query(
    `UPDATE activity_log SET stage = 'ai_reviewing', detail = $1 WHERE reference_id = $2`,
    [`Review at "${rev.restaurant_name}" reported for "${reason}"${detail ? `: ${detail}` : ''}. AI is reviewing…`, rrId]
  ).catch(() => {});

  let analysis;
  try {
    analysis = await analyzeReviewReport(
      { body: rev.body, rating: rev.rating, restaurant_name: rev.restaurant_name },
      { reason, detail }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE activity_log SET stage = 'error', detail = $1 WHERE reference_id = $2`,
      [`Review at "${rev.restaurant_name}" reported for "${reason}". AI review failed: ${msg}`, rrId]
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // ── Step 4: Update report record with AI verdict, mark complete ────────────
  await query(
    `UPDATE review_reports SET ai_action = $1, ai_summary = $2, ai_confidence = $3 WHERE id = $4`,
    [analysis.action, analysis.summary, analysis.confidence, rrId]
  ).catch(() => {});

  const aiVerdict = `AI: ${analysis.action} (${analysis.confidence}%) — ${analysis.summary}`;
  await query(
    `UPDATE activity_log SET stage = 'complete', detail = $1 WHERE reference_id = $2`,
    [`Review at "${rev.restaurant_name}" reported for "${reason}"${detail ? `: ${detail}` : ''}. ${aiVerdict}`, rrId]
  ).catch(() => {});

  return NextResponse.json({ ok: true, action: analysis.action, summary: analysis.summary });
}
