import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { analyzeReport } from '@/lib/gemini-moderation';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { reason, detail } = await req.json() as { reason: string; detail?: string };
  if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 });

  const VALID_REASONS = ['wrong_info', 'fake_listing', 'offensive_content', 'incorrect_dietary_tags', 'other'];
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: 'Invalid reason' }, { status: 400 });
  }

  const restaurants = await query<{
    id: string; name: string; address: string; cuisine_type: string[]; status: string;
  }>(`SELECT id, name, address, cuisine_type, status FROM restaurants WHERE id = $1`, [id]);
  if (!restaurants.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const restaurant = restaurants[0];

  // ── Step 1: Insert report immediately, AI results filled in below ──────────
  // ON CONFLICT handles re-reports from the same user (updates details, re-runs AI)
  const reportRows = await query<{ id: string }>(
    `INSERT INTO reports (restaurant_id, user_id, reason, detail, ai_status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (restaurant_id, user_id) DO UPDATE
       SET reason = EXCLUDED.reason, detail = EXCLUDED.detail, ai_status = 'pending'
     RETURNING id`,
    [id, session.user.id, reason, detail ?? null]
  );
  const reportId = reportRows[0]?.id ?? null;

  await query(`UPDATE restaurants SET report_count = report_count + 1 WHERE id = $1`, [id]);

  // ── Step 2: Write activity log immediately so admin can see it ─────────────
  await query(
    `INSERT INTO activity_log (admin_id, action, target_type, target_id, detail, reference_id, stage)
     VALUES ($1, $2, 'restaurant', $3, $4, $5, 'received')`,
    [session.user.id, 'restaurant_reported', id,
     `"${restaurant.name}" reported for "${reason}"${detail ? `: ${detail}` : ''}. AI review pending…`,
     reportId]
  ).catch(() => {});

  // ── Step 3: Update to ai_reviewing, run AI ─────────────────────────────────
  await query(
    `UPDATE activity_log SET stage = 'ai_reviewing', detail = $1 WHERE reference_id = $2`,
    [`"${restaurant.name}" reported for "${reason}"${detail ? `: ${detail}` : ''}. AI is reviewing…`, reportId]
  ).catch(() => {});

  let analysis;
  try {
    analysis = await analyzeReport(
      { name: restaurant.name, address: restaurant.address, cuisine_type: restaurant.cuisine_type },
      { reason, detail }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(`UPDATE reports SET ai_status = 'error' WHERE id = $1`, [reportId]).catch(() => {});
    await query(
      `UPDATE activity_log SET stage = 'error', detail = $1 WHERE reference_id = $2`,
      [`"${restaurant.name}" reported for "${reason}". AI review failed: ${msg}`, reportId]
    ).catch(() => {});
    return NextResponse.json({ received: true });
  }

  // ── Step 4: Save AI results, apply action, mark complete ──────────────────
  await query(
    `UPDATE reports SET ai_action = $1, ai_summary = $2, ai_confidence = $3, ai_status = 'complete' WHERE id = $4`,
    [analysis.action, analysis.summary, analysis.confidence, reportId]
  );

  const updated = await query<{ report_count: number }>(
    `SELECT report_count FROM restaurants WHERE id = $1`, [id]
  );
  const reportCount = updated[0]?.report_count ?? 0;

  let newStatus = restaurant.status;
  if (analysis.action === 'remove') {
    newStatus = 'removed';
  } else if (analysis.action === 'flag' || reportCount >= 3) {
    newStatus = 'flagged';
  }
  if (newStatus !== restaurant.status) {
    await query(`UPDATE restaurants SET status = $1 WHERE id = $2`, [newStatus, id]);
  }

  const aiVerdict = `AI: ${analysis.action} (${analysis.confidence}%) — ${analysis.summary}`;
  await query(
    `UPDATE activity_log SET stage = 'complete', detail = $1 WHERE reference_id = $2`,
    [`"${restaurant.name}" reported for "${reason}"${detail ? `: ${detail}` : ''}. ${aiVerdict}. Status: ${restaurant.status}${newStatus !== restaurant.status ? ` → ${newStatus}` : ' (unchanged)'}`, reportId]
  ).catch(() => {});

  return NextResponse.json({ received: true, action: analysis.action, summary: analysis.summary });
}
