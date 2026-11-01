import { useCallback, useEffect, useState } from 'react';
import { api, type Category } from './api';
import { monthKey } from './format';
import { Overview } from './pages/Overview';
import { MonthPage } from './pages/MonthPage';
import { Categories } from './pages/Categories';
import { DataPage } from './pages/Data';
import { FrequentPayments } from './pages/FrequentPayments';
import { Trends } from './pages/Trends';
import { Search } from './pages/Search';
import { Owed } from './pages/Owed';

type Route =
  | { page: 'overview'; year: number }
  | { page: 'month'; month: string }
  | { page: 'trends' }
  | { page: 'search' }
  | { page: 'payments' }
  | { page: 'owed' }
  | { page: 'categories' }
  | { page: 'data' };

function parseHash(hash: string): Route {
  const [page, param] = hash.replace(/^#\/?/, '').split('/');
  if (page === 'month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(param ?? '')) return { page: 'month', month: param };
  if (page === 'trends' || page === 'search' || page === 'payments' || page === 'owed' || page === 'categories' || page === 'data') return { page };
  if (page === 'import') return { page: 'data' }; // the import page now lives under Data
  const year = Number(param);
  return { page: 'overview', year: Number.isInteger(year) && year > 0 ? year : new Date().getFullYear() };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadCategories = useCallback(() => {
    api.categories().then(setCategories, (e: Error) => setError(e.message));
  }, []);
  useEffect(reloadCategories, [reloadCategories]);

  const now = new Date();
  const currentMonth = monthKey(now.getFullYear(), now.getMonth() + 1);
  const link = (page: Route['page'], href: string, label: string) => (
    <a href={href} className={route.page === page ? 'active' : ''}>{label}</a>
  );

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">Expense Tracker</a>
        <nav>
          {link('overview', '#/', 'Overview')}
          {link('month', `#/month/${route.page === 'month' ? route.month : currentMonth}`, 'Months')}
          {link('trends', '#/trends', 'Trends')}
          {link('search', '#/search', 'Search')}
          {link('payments', '#/payments', 'Frequent payments')}
          {link('owed', '#/owed', 'Owed to me')}
          {link('categories', '#/categories', 'Categories')}
          {link('data', '#/data', 'Data')}
        </nav>
      </header>
      <main>
        {error && <div className="error-banner">{error}</div>}
        {categories &&
          (route.page === 'overview' ? (
            <Overview year={route.year} categories={categories} />
          ) : route.page === 'month' ? (
            <MonthPage month={route.month} categories={categories} onChange={reloadCategories} />
          ) : route.page === 'trends' ? (
            <Trends categories={categories} />
          ) : route.page === 'search' ? (
            <Search categories={categories} />
          ) : route.page === 'payments' ? (
            <FrequentPayments categories={categories} />
          ) : route.page === 'owed' ? (
            <Owed categories={categories} />
          ) : route.page === 'data' ? (
            <DataPage categories={categories} onChange={reloadCategories} />
          ) : (
            <Categories categories={categories} onChange={reloadCategories} />
          ))}
      </main>
    </div>
  );
}
