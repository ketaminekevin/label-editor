import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

// Ensure table exists (idempotent)
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS review_votes (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      review_id   UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      vote        SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, review_id)
    )
  `, []);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: reviewId } = await params;
  const { vote } = await req.json() as { vote: 1 | -1 };

  if (vote !== 1 && vote !== -1) {
    return NextResponse.json({ error: 'vote must be 1 or -1' }, { status: 400 });
  }

  await ensureTable();

  // Upsert: if same vote again → remove it (toggle off). Otherwise set new vote.
  const existing = await query<{ vote: number }>(
    `SELECT vote FROM review_votes WHERE user_id = $1 AND review_id = $2`,
    [session.user.id, reviewId]
  );

  if (existing.length && existing[0].vote === vote) {
    // Toggle off
    await query(
      `DELETE FROM review_votes WHERE user_id = $1 AND review_id = $2`,
      [session.user.id, reviewId]
    );
  } else {
    await query(
      `INSERT INTO review_votes (user_id, review_id, vote)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, review_id) DO UPDATE SET vote = EXCLUDED.vote`,
      [session.user.id, reviewId, vote]
    );
  }

  const counts = await query<{ upvotes: string; downvotes: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE vote = 1)  AS upvotes,
       COUNT(*) FILTER (WHERE vote = -1) AS downvotes
     FROM review_votes WHERE review_id = $1`,
    [reviewId]
  );

  const myVote = await query<{ vote: number }>(
    `SELECT vote FROM review_votes WHERE user_id = $1 AND review_id = $2`,
    [session.user.id, reviewId]
  );

  return NextResponse.json({
    upvotes: Number(counts[0].upvotes),
    downvotes: Number(counts[0].downvotes),
    my_vote: myVote[0]?.vote ?? null,
  });
}
