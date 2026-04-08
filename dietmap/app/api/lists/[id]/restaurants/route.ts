import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

// Verify the list belongs to the current user
async function ownsListCheck(listId: string, userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM lists WHERE id = $1 AND user_id = $2`,
    [listId, userId]
  );
  return rows.length > 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: listId } = await params;
  const { restaurantId } = await req.json();

  if (!await ownsListCheck(listId, session.user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await query(
    `INSERT INTO restaurant_lists (list_id, restaurant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [listId, restaurantId]
  );
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: listId } = await params;
  const { restaurantId } = await req.json();

  if (!await ownsListCheck(listId, session.user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await query(
    `DELETE FROM restaurant_lists WHERE list_id = $1 AND restaurant_id = $2`,
    [listId, restaurantId]
  );
  return NextResponse.json({ ok: true });
}
