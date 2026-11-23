import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { CatalogFacets } from "@sonic/shared";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Catalog filters beyond search + tag. Live in the URL so they survive refresh/back and can be linked. */
export interface CatalogFilterValues {
  label: string | null;
  country: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

const KEYS = ["label", "country", "yearFrom", "yearTo"] as const;
type FilterKey = (typeof KEYS)[number];
/** Radix Select can't use "" as a value; this stands for "no filter". */
const ANY = "__any";

const int = (v: string | null) => (v && /^\d{1,4}$/.test(v) ? Number(v) : null);

export function useCatalogFilters() {
  const [params, setParams] = useSearchParams();
  const values: CatalogFilterValues = {
    label: params.get("label") || null,
    country: params.get("country") || null,
    yearFrom: int(params.get("yearFrom")),
    yearTo: int(params.get("yearTo")),
  };
  const set = (key: FilterKey, value: string | number | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === "") next.delete(key);
        else next.set(key, String(value));
        return next;
      },
      { replace: true },
    );
  const clear = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of KEYS) next.delete(k);
        return next;
      },
      { replace: true },
    );
  const active = KEYS.filter((k) => values[k] !== null).length;
  return { values, set, clear, active };
}

export function useCatalogFacets() {
  return useQuery({ queryKey: ["catalog", "facets"], queryFn: () => api.catalogFacets() });
}

/** Toggle for the filters panel, with a count of active filters. */
export function FiltersButton({ open, onToggle, active }: { open: boolean; onToggle: () => void; active: number }) {
  return (
    <Button variant={open || active ? "secondary" : "outline"} onClick={onToggle} aria-expanded={open} aria-controls="catalog-filters">
      <SlidersHorizontal className="size-4" />
      Filters
      {active > 0 && (
        <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] leading-5 text-primary-foreground tabular-nums">{active}</span>
      )}
    </Button>
  );
}

/** Label / country / year range, with choices (and counts) from the user's own catalog. */
export function FiltersPanel({
  values,
  set,
  clear,
  facets,
}: {
  values: CatalogFilterValues;
  set: (key: FilterKey, value: string | number | null) => void;
  clear: () => void;
  facets: CatalogFacets | undefined;
}) {
  const years = facets?.years.map((y) => y.year) ?? [];
  // Keep a value from the URL selectable even if no entry has it any more.
  const withCurrent = (list: { value: string; count: number }[], current: string | null) =>
    current && !list.some((x) => x.value.toLowerCase() === current.toLowerCase()) ? [{ value: current, count: 0 }, ...list] : list;
  const yearOptions = (current: number | null) => (current !== null && !years.includes(current) ? [...years, current].sort((a, b) => a - b) : years);

  return (
    <div id="catalog-filters" className="mb-6 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          id="filter-label"
          label="Label"
          value={values.label}
          options={withCurrent(facets?.labels ?? [], values.label).map((l) => ({ value: l.value, text: l.value, count: l.count }))}
          onChange={(v) => set("label", v)}
          missing={facets?.missing.label}
        />
        <FilterSelect
          id="filter-country"
          label="Country"
          value={values.country}
          options={withCurrent(facets?.countries ?? [], values.country).map((c) => ({ value: c.value, text: c.value, count: c.count }))}
          onChange={(v) => set("country", v)}
          missing={facets?.missing.country}
        />
        <FilterSelect
          id="filter-year-from"
          label="Released from"
          value={values.yearFrom === null ? null : String(values.yearFrom)}
          options={yearOptions(values.yearFrom)
            .filter((y) => values.yearTo === null || y <= values.yearTo)
            .map((y) => ({ value: String(y), text: String(y) }))}
          onChange={(v) => set("yearFrom", v)}
          missing={facets?.missing.year}
        />
        <FilterSelect
          id="filter-year-to"
          label="Released to"
          value={values.yearTo === null ? null : String(values.yearTo)}
          options={yearOptions(values.yearTo)
            .filter((y) => values.yearFrom === null || y >= values.yearFrom)
            .map((y) => ({ value: String(y), text: String(y) }))}
          onChange={(v) => set("yearTo", v)}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Options come from your catalog. Filters combine with the search and tag.</p>
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
  missing,
}: {
  id: string;
  label: string;
  value: string | null;
  options: { value: string; text: string; count?: number }[];
  onChange: (value: string | null) => void;
  /** Entries without this field; they never match a filter on it. */
  missing?: number;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="label-mono">
        {label}
      </Label>
      <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? null : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Any" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="truncate">{o.text}</span>
              {o.count !== undefined && <span className="ml-auto pl-3 font-mono text-[11px] text-muted-foreground tabular-nums">{o.count}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!!missing && (
        <p className="text-[11px] text-muted-foreground">
          {missing} record{missing === 1 ? "" : "s"} without one
        </p>
      )}
    </div>
  );
}

/** Removable chips for the active filters, shown when the panel is closed. */
export function ActiveFilterChips({
  values,
  set,
  clear,
}: {
  values: CatalogFilterValues;
  set: (key: FilterKey, value: string | number | null) => void;
  clear: () => void;
}) {
  const chips: { key: FilterKey | "years"; text: string; remove: () => void }[] = [];
  if (values.label) chips.push({ key: "label", text: `Label: ${values.label}`, remove: () => set("label", null) });
  if (values.country) chips.push({ key: "country", text: `Country: ${values.country}`, remove: () => set("country", null) });
  if (values.yearFrom !== null || values.yearTo !== null) {
    const text =
      values.yearFrom !== null && values.yearTo !== null
        ? values.yearFrom === values.yearTo
          ? `Released ${values.yearFrom}`
          : `Released ${values.yearFrom}–${values.yearTo}`
        : values.yearFrom !== null
          ? `Released ${values.yearFrom} or later`
          : `Released ${values.yearTo} or earlier`;
    chips.push({
      key: "years",
      text,
      remove: () => {
        set("yearFrom", null);
        set("yearTo", null);
      },
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="-mt-2 mb-6 flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex h-7 items-center gap-1 rounded-full border border-primary bg-primary/10 pl-3 pr-1 text-xs">
          {c.text}
          <button
            type="button"
            onClick={c.remove}
            aria-label={`Remove filter ${c.text}`}
            className={cn("rounded-full p-1 hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-ring")}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <Button variant="ghost" size="sm" className="h-7" onClick={clear}>
          Clear all
        </Button>
      )}
    </div>
  );
}
