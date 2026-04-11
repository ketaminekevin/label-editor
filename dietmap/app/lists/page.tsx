'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { List } from '@/lib/types';
import { Plus, Trash2, Pencil, Check, X, Sparkles } from 'lucide-react';
import clsx from 'clsx';

const LIST_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899'];

export default function ListsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    fetch('/api/lists')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setLists(data); })
      .finally(() => setLoading(false));
  }, [session]);

  const createList = async () => {
    if (!newName.trim()) return;
    const data = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    }).then(r => r.json());
    setLists(l => [...l, { ...data, restaurant_count: 0, restaurant_ids: [] }]);
    setNewName('');
    setShowForm(false);
  };

  const deleteList = async (id: string) => {
    if (!confirm('Delete this list? This cannot be undone.')) return;
    await fetch(`/api/lists/${id}`, { method: 'DELETE' });
    setLists(l => l.filter(x => x.id !== id));
  };

  const startEdit = (list: List) => {
    setEditingId(list.id);
    setEditName(list.name);
    setEditColor(list.color);
  };

  const saveEdit = async (id: string) => {
    await fetch(`/api/lists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim(), color: editColor }),
    });
    setLists(l => l.map(x => x.id === id ? { ...x, name: editName.trim(), color: editColor } : x));
    setEditingId(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">My Lists</h1>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
          >
            <Plus size={14} />
            New List
          </button>
        </div>

        {/* New list form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
            <h2 className="font-semibold text-gray-800 text-sm">Create a new list</h2>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createList()}
              placeholder="List name…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              autoFocus
            />
            <div>
              <p className="text-xs text-slate-500 mb-2">Choose a colour</p>
              <div className="flex gap-2 flex-wrap">
                {LIST_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={clsx('w-7 h-7 rounded-full border-2 transition-transform', newColor === c ? 'border-slate-900 scale-110' : 'border-transparent hover:scale-105')}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={createList}
                disabled={!newName.trim()}
                className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
              >
                Create
              </button>
              <button onClick={() => { setShowForm(false); setNewName(''); }} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-xl animate-pulse" />)}
          </div>
        ) : lists.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <p className="font-medium text-gray-600">No lists yet</p>
            <p className="text-sm mt-1">Create a list to organise your favourite restaurants</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lists.map(list => (
              <div key={list.id} className={clsx('bg-white rounded-xl border p-4', list.scan_id ? 'border-violet-200 bg-violet-50/30' : 'border-slate-100')}>
                {editingId === list.id ? (
                  <div className="space-y-2.5">
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                      autoFocus
                    />
                    <div className="flex gap-1.5 flex-wrap">
                      {LIST_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={clsx('w-6 h-6 rounded-full border-2 transition-transform', editColor === c ? 'border-slate-900 scale-110' : 'border-transparent')}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(list.id)} className="px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700">
                        <Check size={12} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {list.scan_id
                      ? <Sparkles size={16} className="text-violet-500 flex-shrink-0" />
                      : <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: list.color }} />
                    }
                    <Link
                      href={list.scan_id ? `/scan/${list.scan_id}` : `/lists/${list.id}`}
                      className="flex-1 min-w-0 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={clsx('font-semibold', list.scan_id ? 'text-violet-700 hover:text-violet-900' : 'text-gray-800 hover:text-blue-600')}>{list.name}</p>
                        {list.scan_id && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200 font-medium">
                            Smart Search
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{list.restaurant_count ?? 0} restaurant{(list.restaurant_count ?? 0) !== 1 ? 's' : ''}</p>
                    </Link>
                    <div className="flex items-center gap-1">
                      {!list.scan_id && (
                        <button
                          onClick={() => startEdit(list)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => deleteList(list.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Link href="/" className="block text-center text-sm text-violet-600 hover:text-violet-700 font-medium">
          ← Back to map
        </Link>
      </div>
    </div>
  );
}
