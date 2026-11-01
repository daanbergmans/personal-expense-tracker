import { useState, type FormEvent } from 'react';
import { api, type Category, type TxType } from '../api';

interface Props {
  categories: Category[];
  onChange: () => void;
}

export function Categories({ categories, onChange }: Props) {
  return (
    <div className="categories-page">
      <div className="page-header">
        <h1>Categories</h1>
      </div>
      <div className="panels">
        {(['income', 'expense'] as const).map((type) => (
          <CategoryList key={type} type={type} categories={categories.filter((c) => c.type === type)} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

function CategoryList({ type, categories, onChange }: { type: TxType; categories: Category[]; onChange: () => void }) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
      onChange();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await run(() => api.createCategory(newName, type))) setNewName('');
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (editingId === null) return;
    if (await run(() => api.renameCategory(editingId, editName))) setEditingId(null);
  }

  function remove(c: Category) {
    if (confirm(`Delete category "${c.name}"?`)) run(() => api.deleteCategory(c.id));
  }

  return (
    <section className={`panel panel-${type}`}>
      <header className="panel-header">
        <h2>{type === 'income' ? 'Categories incoming' : 'Categories outgoing'}</h2>
        <span className="panel-total">{categories.length}</span>
      </header>
      <ul className="category-list">
        {categories.map((c) => (
          <li key={c.id}>
            {editingId === c.id ? (
              <form className="inline-form" onSubmit={rename}>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                  aria-label="Category name"
                  autoFocus
                />
                <button className="btn primary small">Save</button>
                <button type="button" className="icon-btn small" title="Cancel" onClick={() => setEditingId(null)}>↶</button>
              </form>
            ) : (
              <>
                <span className="category-name">{c.name}</span>
                {type === 'expense' && (
                  <label className="saving-toggle" title="Money put aside (investing, savings) instead of spent: shown as saved, not spent">
                    <input type="checkbox" checked={c.isSaving} onChange={(e) => run(() => api.setCategorySaving(c.id, e.target.checked))} />
                    counts as saving
                  </label>
                )}
                <span className="muted-text usage">{c.usage === 1 ? '1 entry' : `${c.usage} entries`}</span>
                <button
                  className="icon-btn small"
                  title="Rename"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditName(c.name);
                  }}
                >
                  ✎
                </button>
                <button
                  className="icon-btn small danger"
                  title={c.usage ? 'In use: move its entries to another category first' : 'Delete'}
                  disabled={c.usage > 0}
                  onClick={() => remove(c)}
                >
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="inline-form add-category" onSubmit={add}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category" aria-label="New category name" />
        <button className="btn primary small" disabled={!newName.trim()}>Add</button>
      </form>
      {error && <p className="row-error">{error}</p>}
    </section>
  );
}
