'use client';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { User, LogOut, Plus, List, Sparkles } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

export function Navbar() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="relative z-50 flex items-center justify-between px-4 h-13 bg-white border-b border-gray-100 shadow-sm">
      <Link href="/" className="flex items-center gap-2 font-bold text-gray-900 text-lg">
        <span className="w-2.5 h-2.5 rounded-full bg-blue-600 flex-shrink-0" />
        DietMap
      </Link>

      <div className="flex items-center gap-1">
        {session ? (
          <>
            <Link
              href="/add"
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Plus size={14} />
              Add
            </Link>

            <Link
              href="/lists"
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <List size={14} />
              Lists
            </Link>

            <Link
              href="/scan"
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <Sparkles size={14} />
              Plan Trip
            </Link>

            <div className="relative">
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {session.user?.image ? (
                  <img src={session.user.image} alt="" className="w-7 h-7 rounded-full" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                    <User size={14} className="text-blue-700" />
                  </div>
                )}
                <span className="text-sm font-medium text-gray-700 max-w-[100px] truncate">
                  {session.user?.name?.split(' ')[0]}
                </span>
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-100 rounded-xl shadow-lg z-50 overflow-hidden">
                    <Link
                      href="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <User size={14} /> Profile & Settings
                    </Link>
                    <Link
                      href="/lists"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <List size={14} /> My Lists
                    </Link>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={() => { setMenuOpen(false); signOut(); }}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-600',
                        'hover:bg-red-50 transition-colors'
                      )}
                    >
                      <LogOut size={14} /> Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              Log In
            </Link>
            <Link
              href="/signup"
              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              Sign Up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
