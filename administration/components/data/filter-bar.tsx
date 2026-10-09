'use client';

import { RotateCcw, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

/** Rangée de filtres au-dessus d'une liste (une seule rangée, alignée à gauche). */
export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="border-line flex flex-wrap items-center gap-2 border-b px-4 py-3">
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} className="ml-auto">
          <RotateCcw /> Réinitialiser
        </Button>
      )}
    </div>
  );
}

/** Recherche avec délai : la liste n'est rechargée qu'après une pause de saisie. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  // Valeur changée de l'extérieur (réinitialisation des filtres) : resynchronisée au rendu.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  const debounced = useDebouncedValue(draft);
  useEffect(() => {
    if (debounced !== value) onChange(debounced.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className="relative w-full sm:w-72">
      <Search
        aria-hidden
        className="text-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9"
      />
    </div>
  );
}
