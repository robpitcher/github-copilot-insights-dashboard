"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/locale-provider";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  label: string;
  /** Label shown when nothing is selected (and for the "clear" entry). */
  allLabel: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  /** Shown (and the control disabled) when there are no options. */
  emptyHint?: string;
}

/**
 * Searchable, multi-select filter dropdown. A summary button opens a panel with
 * a search box and a checkbox list — the same pattern used by the shared report
 * filters, generalized for reuse.
 */
export function MultiSelectFilter({
  label,
  allLabel,
  options,
  selected,
  onChange,
  emptyHint,
}: MultiSelectFilterProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const hasOptions = options.length > 0;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const selectedSet = new Set(selected);
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? t("common.selectedCount", 1)
        : t("common.selectedCount", selected.length);

  const toggle = (value: string) =>
    onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => hasOptions && setOpen((v) => !v)}
          disabled={!hasOptions}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-left text-sm text-gray-700 shadow-xs focus:border-blue-500 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <span className="truncate">{hasOptions ? summary : (emptyHint ?? allLabel)}</span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-gray-400 transition-transform", open && "rotate-180")}
          />
        </button>
        {open && hasOptions && (
          <div className="absolute z-50 mt-1 w-full min-w-56 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
            <div className="border-b border-gray-100 p-2 dark:border-gray-700">
              <input
                type="text"
                placeholder={t("common.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-sm border border-gray-200 px-2.5 py-1.5 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-hidden dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                autoFocus
              />
            </div>
            <ul className="max-h-60 overflow-y-auto py-1">
              <li>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className={cn(
                    "w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700",
                    selected.length === 0
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : "text-gray-700 dark:text-gray-300",
                  )}
                >
                  {allLabel}
                </button>
              </li>
              {filtered.map((o) => (
                <li key={o.value}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(o.value)}
                      onChange={() => toggle(o.value)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="truncate text-gray-700 dark:text-gray-300">{o.label}</span>
                  </label>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                  {t("common.noResults")}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </label>
  );
}
