import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { pro } = await req.json() as { pro: boolean };

  await query(
    `UPDATE users SET
       account_tier = $1,
       scans_remaining = $2,
       updated_at = NOW()
     WHERE id = $3`,
    [pro ? 'pro' : 'free', pro ? 99 : 0, session.user.id]
  );

  return NextResponse.json({ ok: true, account_tier: pro ? 'pro' : 'free', scans_remaining: pro ? 99 : 0 });
}
