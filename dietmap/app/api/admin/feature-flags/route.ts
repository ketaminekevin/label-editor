import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const flags = await query<{ key: string; enabled: boolean }>(
    'SELECT key, enabled FROM feature_flags ORDER BY key'
  );
  return NextResponse.json(flags);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key, enabled } = await req.json() as { key: string; enabled: boolean };
  if (!key || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'key and enabled required' }, { status: 400 });
  }

  await query(
    `INSERT INTO feature_flags (key, enabled, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET enabled = $2, updated_at = NOW()`,
    [key, enabled]
  );
  return NextResponse.json({ ok: true });
}
