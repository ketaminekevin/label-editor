import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { User } from '@/lib/types';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await query<User>(
    `SELECT id, email, name, avatar_url, subscription_tier, account_tier, scans_remaining, dietary_profile, created_at
     FROM users WHERE id = $1`,
    [session.user.id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { name, dietary_profile } = await req.json();
  await query(
    `UPDATE users SET name = COALESCE($1, name),
     dietary_profile = COALESCE($2, dietary_profile),
     updated_at = NOW() WHERE id = $3`,
    [name ?? null, dietary_profile ? JSON.stringify(dietary_profile) : null, session.user.id]
  );
  return NextResponse.json({ ok: true });
}
