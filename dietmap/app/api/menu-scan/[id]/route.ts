import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const rows = await query<{
    id: string;
    ai_result: object;
    restaurant_name: string | null;
    cuisine_type: string | null;
    dietary_tags: string[];
    detected_language: string;
    created_at: string;
  }>(
    `SELECT id, ai_result, restaurant_name, cuisine_type, dietary_tags, detected_language, created_at
     FROM menu_scans WHERE id = $1 AND user_id = $2`,
    [id, session.user.id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const row = rows[0];
  return NextResponse.json({ ...(row.ai_result as object), id: row.id });
}
