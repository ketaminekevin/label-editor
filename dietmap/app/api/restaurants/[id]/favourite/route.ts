import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await query(
    `INSERT INTO favourites (user_id, restaurant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [session.user.id, id]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await query(
    `DELETE FROM favourites WHERE user_id = $1 AND restaurant_id = $2`,
    [session.user.id, id]
  );
  return NextResponse.json({ ok: true });
}
