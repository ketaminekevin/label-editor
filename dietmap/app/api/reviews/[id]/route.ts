import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const rows = await query<{ id: string; restaurant_id: string }>(
    `DELETE FROM reviews WHERE id = $1 AND user_id = $2 RETURNING id, restaurant_id`,
    [id, session.user.id]
  );

  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // If the restaurant now has zero reviews and is community-added, hide it from the public map
  try {
    const { restaurant_id } = rows[0];
    await query(
      `UPDATE restaurants SET visibility = 'private'
       WHERE id = $1
         AND source = 'user_added'
         AND visibility = 'public'
         AND NOT EXISTS (SELECT 1 FROM reviews WHERE restaurant_id = $1)`,
      [restaurant_id]
    );
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true });
}
