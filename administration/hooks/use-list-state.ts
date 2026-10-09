'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/**
 * État d'une liste (page, filtres) porté par l'URL : partageable, conservé au retour
 * arrière. Changer un filtre revient à la page 1.
 */
export function useListState<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const keyList = keys.join('|');
  const filters = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const key of keyList.split('|') as K[]) out[key] = params.get(key) ?? '';
    return out;
  }, [params, keyList]);
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const replace = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const setFilter = useCallback(
    (key: K, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      replace(next);
    },
    [params, replace],
  );

  const setPage = useCallback(
    (value: number) => {
      const next = new URLSearchParams(params.toString());
      if (value > 1) next.set('page', String(value));
      else next.delete('page');
      replace(next);
    },
    [params, replace],
  );

  const reset = useCallback(() => replace(new URLSearchParams()), [replace]);

  return { filters, page, setFilter, setPage, reset };
}
