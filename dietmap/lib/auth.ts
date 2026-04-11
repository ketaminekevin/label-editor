import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { query } from './db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Legacy SHA-256 hash for migration path only
function legacyHash(password: string): string {
  return crypto.createHash('sha256').update(password + process.env.NEXTAUTH_SECRET).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Bcrypt hashes start with $2b$ or $2a$
  if (storedHash.startsWith('$2')) {
    return bcrypt.compare(password, storedHash);
  }
  // Legacy SHA-256 hash
  return legacyHash(password) === storedHash;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    newUser: '/signup',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const rows = await query<{
          id: string; email: string; name: string;
          avatar_url: string | null; password_hash: string | null;
          subscription_tier: string; dietary_profile: Record<string, boolean>;
        }>(
          'SELECT * FROM users WHERE email = $1 LIMIT 1',
          [credentials.email.toLowerCase().trim()]
        );
        const user = rows[0];
        if (!user || !user.password_hash) return null;
        const valid = await verifyPassword(credentials.password, user.password_hash);
        if (!valid) return null;
        // Upgrade legacy SHA-256 hash to bcrypt on successful login
        if (!user.password_hash.startsWith('$2')) {
          const newHash = await hashPassword(credentials.password);
          await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]).catch(() => {});
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatar_url,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        const email = user.email?.toLowerCase().trim() ?? '';
        const existing = await query<{ id: string }>(
          'SELECT id FROM users WHERE email = $1',
          [email]
        );
        if (!existing.length) {
          await query(
            `INSERT INTO users (email, name, avatar_url) VALUES ($1, $2, $3)`,
            [email, user.name, user.image]
          );
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      // Always resolve ID + role from DB so stale JWTs self-heal
      if (token.email) {
        const rows = await query<{ id: string; role: string }>(
          'SELECT id, role FROM users WHERE email = $1',
          [token.email.toLowerCase().trim()]
        );
        if (rows[0]) { token.id = rows[0].id; token.role = rows[0].role; }
        else { delete token.id; delete token.role; }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      if (token.role) session.user.role = token.role as string;
      return session;
    },
  },
};

export { verifyPassword };
