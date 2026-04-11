import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { name, email: rawEmail, password } = await req.json();
  const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.length) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const hash = await hashPassword(password);
  const rows = await query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [name, email, hash]
  );
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
