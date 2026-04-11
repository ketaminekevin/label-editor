import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin' && session.user.role !== 'moderator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await query(`
    SELECT
      al.id,
      al.action,
      al.target_type,
      al.target_id::text,
      al.detail        AS log_detail,
      al.stage,
      al.created_at,

      -- Actor
      actor.id::text   AS actor_id,
      actor.name       AS actor_name,
      actor.email      AS actor_email,

      -- Total reports by this actor
      (SELECT COUNT(*) FROM reports          WHERE user_id = al.admin_id) +
      (SELECT COUNT(*) FROM review_reports   WHERE user_id = al.admin_id) AS actor_total_reports,

      -- Restaurant report details
      rp.reason        AS report_reason,
      rp.detail        AS report_notes,
      rp.ai_action,
      rp.ai_summary,
      rp.ai_confidence,
      rp.resolved_at   AS rp_resolved_at,
      rp_resolver.name AS rp_resolver_name,

      -- Review report details (including AI)
      rvr.reason            AS rr_reason,
      rvr.detail            AS rr_notes,
      rvr.ai_action         AS rr_ai_action,
      rvr.ai_summary        AS rr_ai_summary,
      rvr.ai_confidence     AS rr_ai_confidence,
      rvr.resolved_at       AS rr_resolved_at,
      rvr_resolver.name     AS rr_resolver_name,

      -- Restaurant target
      rest.name             AS restaurant_name,
      rest.address          AS restaurant_address,
      rest.status           AS restaurant_status,
      rest.cuisine_type     AS restaurant_cuisine,
      rest.report_count     AS restaurant_report_count,

      -- Review target
      rev.rating            AS review_rating,
      rev.body              AS review_body,
      rev.hidden            AS review_hidden,
      rev_author.name       AS review_author_name,
      rev_rest.id::text     AS review_restaurant_id,
      rev_rest.name         AS review_restaurant_name

    FROM activity_log al
    LEFT JOIN users actor          ON actor.id = al.admin_id

    LEFT JOIN reports rp           ON rp.id  = al.reference_id AND al.target_type = 'restaurant'
    LEFT JOIN users rp_resolver    ON rp_resolver.id = rp.resolved_by

    LEFT JOIN review_reports rvr   ON rvr.id = al.reference_id AND al.target_type = 'review'
    LEFT JOIN users rvr_resolver   ON rvr_resolver.id = rvr.resolved_by

    LEFT JOIN restaurants rest     ON rest.id = al.target_id AND al.target_type = 'restaurant'

    LEFT JOIN reviews rev          ON rev.id  = al.target_id AND al.target_type = 'review'
    LEFT JOIN users rev_author     ON rev_author.id = rev.user_id
    LEFT JOIN restaurants rev_rest ON rev_rest.id = rev.restaurant_id

    ORDER BY al.created_at DESC
    LIMIT 200
  `);

  return NextResponse.json(rows);
}
