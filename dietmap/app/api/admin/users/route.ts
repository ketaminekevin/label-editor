import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin' && session.user.role !== 'moderator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const tier = searchParams.get('tier') ?? '';

  // Summary stats
  const [statsRows] = await Promise.all([
    query<{
      total: string;
      pro_count: string;
      active_7d: string;
      active_30d: string;
    }>(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE account_tier = 'pro')::text AS pro_count,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM scans s WHERE s.user_id = u.id AND s.created_at > NOW() - INTERVAL '7 days'
          UNION ALL
          SELECT 1 FROM reviews rv WHERE rv.user_id = u.id AND rv.created_at > NOW() - INTERVAL '7 days'
        ))::text AS active_7d,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM scans s WHERE s.user_id = u.id AND s.created_at > NOW() - INTERVAL '30 days'
          UNION ALL
          SELECT 1 FROM reviews rv WHERE rv.user_id = u.id AND rv.created_at > NOW() - INTERVAL '30 days'
        ))::text AS active_30d
      FROM users u
    `),
  ]);

  const stats = {
    total:     parseInt(statsRows[0]?.total     ?? '0'),
    pro_count: parseInt(statsRows[0]?.pro_count ?? '0'),
    active_7d: parseInt(statsRows[0]?.active_7d ?? '0'),
    active_30d:parseInt(statsRows[0]?.active_30d?? '0'),
  };

  // User list
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (q) {
    conditions.push(`(u.email ILIKE $${idx} OR u.name ILIKE $${idx})`);
    values.push(`%${q}%`);
    idx++;
  }
  if (tier) {
    conditions.push(`u.account_tier = $${idx}`);
    values.push(tier);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const users = await query<{
    id: string; name: string; email: string; account_tier: string;
    scans_remaining: number; role: string | null; created_at: string;
    scan_count: string; review_count: string; last_active: string | null;
  }>(`
    SELECT
      u.id, u.name, u.email, u.account_tier, u.scans_remaining,
      u.role, u.created_at,
      COUNT(DISTINCT s.id)::text  AS scan_count,
      COUNT(DISTINCT rv.id)::text AS review_count,
      GREATEST(
        u.updated_at,
        MAX(s.created_at),
        MAX(rv.created_at)
      ) AS last_active,
      EXISTS (
        SELECT 1 FROM scans s2 WHERE s2.user_id = u.id AND s2.created_at > NOW() - INTERVAL '30 days'
        UNION ALL
        SELECT 1 FROM reviews rv2 WHERE rv2.user_id = u.id AND rv2.created_at > NOW() - INTERVAL '30 days'
      ) AS active_30d
    FROM users u
    LEFT JOIN scans s  ON s.user_id  = u.id
    LEFT JOIN reviews rv ON rv.user_id = u.id
    ${where}
    GROUP BY u.id
    ORDER BY last_active DESC NULLS LAST
    LIMIT 200
  `, values);

  return NextResponse.json({ stats, users });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId, action } = await req.json() as { userId: string; action: string };

  if (action === 'make_pro') {
    await query(`UPDATE users SET account_tier = 'pro', scans_remaining = 99 WHERE id = $1`, [userId]);
    await query(`INSERT INTO activity_log (admin_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)`,
      [session.user.id, 'user_upgraded_pro', 'user', userId, `Upgraded to Pro by admin`]);
  } else if (action === 'make_free') {
    await query(`UPDATE users SET account_tier = 'free', scans_remaining = 0 WHERE id = $1`, [userId]);
    await query(`INSERT INTO activity_log (admin_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)`,
      [session.user.id, 'user_downgraded_free', 'user', userId, `Downgraded to Free by admin`]);
  } else if (action === 'make_admin') {
    await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
    await query(`INSERT INTO activity_log (admin_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)`,
      [session.user.id, 'user_role_changed', 'user', userId, `Role set to admin`]);
  } else if (action === 'make_moderator') {
    await query(`UPDATE users SET role = 'moderator' WHERE id = $1`, [userId]);
    await query(`INSERT INTO activity_log (admin_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)`,
      [session.user.id, 'user_role_changed', 'user', userId, `Role set to moderator`]);
  } else if (action === 'remove_role') {
    await query(`UPDATE users SET role = NULL WHERE id = $1`, [userId]);
    await query(`INSERT INTO activity_log (admin_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)`,
      [session.user.id, 'user_role_changed', 'user', userId, `Role removed`]);
  } else if (action === 'delete_account') {
    if (userId === session.user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }
    const target = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
    await query(`INSERT INTO activity_log (admin_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)`,
      [session.user.id, 'user_deleted', 'user', userId, `Account deleted: ${target[0]?.email ?? userId}`]);
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
