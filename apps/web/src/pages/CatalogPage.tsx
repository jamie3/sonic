import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckSquare, Disc3, Search, Tag, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { Capture, CaptureStatus, CatalogEntry, TagSummary, TrashKind } from "@sonic/shared";
import { api } from "@/api";
import { AppHeader } from "@/components/AppHeader";
import {
  ActiveFilterChips,
  FiltersButton,
  FiltersPanel,
  useCatalogFacets,
  useCatalogFilters,
} from "@/components/CatalogFilters";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Badge copy + palette colour for captures that aren't in the catalog yet. */
const UNIDENTIFIED: Partial<Record<CaptureStatus, { label: string; dot: string }>> = {
  processing: { label: "Reading photos…", dot: "bg-mustard-yellow" },
  review: { label: "Checking Discogs…", dot: "bg-harvest-gold" },
  pending_single: { label: "Match found", dot: "bg-avocado-green" },
  pending_multiple: { label: "Pick a match", dot: "bg-teal-blue" },
  pending_nomatch: { label: "Ready to approve", dot: "bg-rust-red" },
};

const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";

/** Something in the catalog grid that can be trashed. */
export type TrashRef = { kind: TrashKind; id: string };
/** Router state for the "Moved to trash · Undo" banner. */
export type TrashedState = { trashed: { items: TrashRef[]; label: string } };

const keyOf = (r: TrashRef) => `${r.kind}:${r.id}`;

export function CatalogPage({ onLogout }: { onLogout: () => void }) {
  const [q, setQ] = useState("");
  // Tag filter lives in the URL (/?tag=Techno) so it survives refresh/back and
  // the record page can link to it.
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag") || null;
  const setTag = (t: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t) next.set("tag", t);
        else next.delete("tag");
        return next;
      },
      { replace: true },
    );
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });
  // Label / country / year range (also in the URL), with choices from the catalog itself.
  const filters = useCatalogFilters();
  const facets = useCatalogFacets();
  const [filtersOpen, setFiltersOpen] = useState(filters.active > 0);
  const f = filters.values;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["catalog", q, tag, f.label, f.country, f.yearFrom, f.yearTo],
    queryFn: () =>
      api.searchCatalog({
        q: q || undefined,
        tag: tag ?? undefined,
        label: f.label ?? undefined,
        country: f.country ?? undefined,
        yearFrom: f.yearFrom ?? undefined,
        yearTo: f.yearTo ?? undefined,
        page: 1,
        pageSize: 40,
      }),
  });
  // Uploaded records the system hasn't identified (or the owner hasn't approved)
  // yet. They have no artist/title to search on, so they show only unfiltered.
  const unidentified = useQuery({
    queryKey: ["captures", "unidentified"],
    queryFn: () => api.listUnidentified(),
    // Poll while anything is still being identified.
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.status === "processing") ? 5000 : false,
  });
  // Unidentified captures have no artist/title/tags/label yet: show them only unfiltered.
  const filtered = !!q || !!tag || filters.active > 0;
  const pending = !filtered ? (unidentified.data ?? []) : [];
  const entries = data?.items ?? [];
  const all: TrashRef[] = [
    ...pending.map((c) => ({ kind: "capture" as const, id: c.id })),
    ...entries.map((e) => ({ kind: "entry" as const, id: e.id })),
  ];

  const queryClient = useQueryClient();
  const refreshAll = () => {
    for (const key of [["catalog"], ["captures"], ["tags"], ["trash"]]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  // Selection mode: tick cards, then trash them together.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<string, TrashRef>>(new Map());
  const toggle = (r: TrashRef) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(keyOf(r))) next.delete(keyOf(r));
      else next.set(keyOf(r), r);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Map());
  };

  // "Moved to trash · Undo" banner — set here, or by the record page.
  const location = useLocation();
  const navigate = useNavigate();
  const trashed = (location.state as TrashedState | null)?.trashed;
  const dismiss = () => navigate(".", { replace: true, state: null });

  const trash = useMutation({
    mutationFn: async (items: TrashRef[]) => {
      await Promise.all(
        items.map((r) => (r.kind === "entry" ? api.trashCatalogEntry(r.id) : api.trashCapture(r.id))),
      );
      return items;
    },
    onSuccess: (items) => {
      refreshAll();
      stopSelecting();
      navigate(".", { replace: true, state: { trashed: { items, label: describe(items, pending, entries) } } });
    },
    onError: refreshAll, // some may have gone through
  });
  const undo = useMutation({
    mutationFn: () => Promise.all(trashed!.items.map((r) => api.restoreFromTrash(r.kind, r.id))),
    onSuccess: () => {
      refreshAll();
      dismiss();
    },
  });

  const hasAny = all.length > 0;
  const allSelected = hasAny && all.every((r) => selected.has(keyOf(r)));

  return (
    <div className="min-h-svh bg-background">
      <AppHeader onLogout={onLogout}>
        <h1 className="truncate text-base font-semibold tracking-tight">Catalog</h1>
        {data && (
          <Badge variant="secondary" className="font-mono tabular-nums">
            {data.total}
          </Badge>
        )}
      </AppHeader>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search artist or title…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <FiltersButton open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} active={filters.active} />
          {hasAny && !selecting && (
            <Button variant="outline" onClick={() => setSelecting(true)}>
              <CheckSquare className="size-4" />
              Select
            </Button>
          )}
        </div>

        {filtersOpen ? (
          <FiltersPanel values={f} set={filters.set} clear={filters.clear} facets={facets.data} />
        ) : (
          <ActiveFilterChips values={f} set={filters.set} clear={filters.clear} />
        )}

        <TagFilter tags={tags.data ?? []} active={tag} onChange={setTag} />

        {/* Selection toolbar */}
        {selecting && (
          <div className="sticky top-16 z-10 mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono tabular-nums">{selected.size}</span> selected
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(allSelected ? new Map() : new Map(all.map((r) => [keyOf(r), r])))
                }
              >
                {allSelected ? "Select none" : "Select all"}
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <ConfirmDialog
                trigger={
                  <Button variant="destructive" size="sm" disabled={selected.size === 0 || trash.isPending}>
                    <Trash2 className="size-4" />
                    {trash.isPending ? "Moving…" : `Move ${selected.size || ""} to trash`.replace("  ", " ")}
                  </Button>
                }
                title={`Move ${selected.size} item${selected.size === 1 ? "" : "s"} to the trash?`}
                description="They'll be removed from your catalog. You can restore them from the Trash for 30 days, after which they're deleted for good."
                confirmLabel="Move to trash"
                destructive
                onConfirm={() => trash.mutate([...selected.values()])}
              />
              <Button variant="ghost" size="sm" onClick={stopSelecting}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {trashed && !selecting && (
          <div
            role="status"
            className="mb-6 flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Trash2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Moved {trashed.label} to the trash.</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => undo.mutate()} disabled={undo.isPending}>
                {undo.isPending ? "Restoring…" : "Undo"}
              </Button>
              <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss">
                <X className="size-4" />
              </Button>
            </span>
          </div>
        )}

        {(isError || trash.isError || undo.isError) && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>
              {isError ? "Couldn’t load the catalog. Is the API server running?" : "Something went wrong. Try again."}
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className={GRID}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : hasAny ? (
          <div className={GRID}>
            {pending.map((capture) => {
              const ref = { kind: "capture" as const, id: capture.id };
              return (
                <GridCard
                  key={keyOf(ref)}
                  {...unidentifiedCardProps(capture)}
                  href="/review"
                  selecting={selecting}
                  selected={selected.has(keyOf(ref))}
                  onToggle={() => toggle(ref)}
                  onTrash={() => trash.mutate([ref])}
                />
              );
            })}
            {entries.map((entry) => {
              const ref = { kind: "entry" as const, id: entry.id };
              return (
                <GridCard
                  key={keyOf(ref)}
                  {...entryCardProps(entry)}
                  href={`/catalog/${entry.id}`}
                  selecting={selecting}
                  selected={selected.has(keyOf(ref))}
                  onToggle={() => toggle(ref)}
                  onTrash={() => trash.mutate([ref])}
                />
              );
            })}
          </div>
        ) : (
          !isError && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm font-medium">No records found</p>
              <p className="text-sm text-muted-foreground">
                {filters.active > 0
                  ? "Nothing matches these filters."
                  : q && tag
                    ? `Nothing matches “${q}” tagged “${tag}”.`
                    : q
                      ? "Try a different search."
                      : tag
                        ? `Nothing tagged “${tag}”.`
                        : "Your catalog is empty."}
              </p>
              {(tag || filters.active > 0) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setTag(null);
                    filters.clear();
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}

/**
 * Tag chips under the search box: one active at a time (the API filters by a
 * single tag). Clicking the active chip, or "All", clears it.
 */
function TagFilter({
  tags,
  active,
  onChange,
}: {
  tags: TagSummary[];
  active: string | null;
  onChange: (tag: string | null) => void;
}) {
  // Keep a tag that's in the URL visible even if no entry carries it any more.
  const shown =
    active && !tags.some((t) => t.name.toLowerCase() === active.toLowerCase())
      ? [{ name: active, count: 0 }, ...tags]
      : tags;
  if (shown.length === 0) return null;
  const isActive = (name: string) => active?.toLowerCase() === name.toLowerCase();
  const chip = (selected: boolean) =>
    cn(
      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
      selected
        ? "border-primary bg-primary text-primary-foreground"
        : "bg-card text-foreground hover:bg-accent",
    );
  return (
    <div role="group" aria-label="Filter by tag" className="-mt-2 mb-6 flex flex-wrap items-center gap-2">
      <Tag className="size-3.5 text-muted-foreground" aria-hidden />
      <button type="button" className={chip(!active)} aria-pressed={!active} onClick={() => onChange(null)}>
        All
      </button>
      {shown.map((t) => (
        <button
          key={t.name}
          type="button"
          className={chip(isActive(t.name))}
          aria-pressed={isActive(t.name)}
          onClick={() => onChange(isActive(t.name) ? null : t.name)}
        >
          {t.name}
          <span className="font-mono text-[10px] tabular-nums opacity-70">{t.count}</span>
        </button>
      ))}
    </div>
  );
}

/** Banner wording: the title for one item, a count for several. */
function describe(items: TrashRef[], captures: Capture[], entries: CatalogEntry[]): string {
  if (items.length !== 1) return `${items.length} items`;
  const r = items[0]!;
  if (r.kind === "entry") {
    const e = entries.find((x) => x.id === r.id);
    return e ? `“${e.release.title}”` : "1 item";
  }
  const c = captures.find((x) => x.id === r.id);
  return c?.candidates[0] ? `“${c.candidates[0].release.title}”` : "an unidentified record";
}

interface CardContent {
  imageUrl: string | null;
  title: string;
  subtitle: string;
  ariaLabel: string;
  confirmText: string;
  unidentified?: { label: string; dot: string; pulsing: boolean };
}

function entryCardProps(entry: CatalogEntry): CardContent {
  const photo = entry.photos.find((p) => p.type === "front") ?? entry.photos[0];
  return {
    imageUrl: entry.release.coverUrl ?? photo?.url ?? null,
    title: entry.release.artist,
    subtitle: entry.release.title,
    ariaLabel: `${entry.release.artist} — ${entry.release.title}`,
    confirmText: `“${entry.release.title}” will be removed from your catalog. You can restore it from the Trash for 30 days.`,
  };
}

function unidentifiedCardProps(capture: Capture): CardContent {
  const state = UNIDENTIFIED[capture.status] ?? { label: capture.status, dot: "bg-muted-foreground" };
  const photo = capture.photos.find((p) => p.type === "front") ?? capture.photos[0];
  const top = capture.candidates[0]?.release;
  return {
    imageUrl: photo?.url ?? null,
    title: top ? top.artist : "Unidentified record",
    subtitle: top
      ? `${top.title} · not yet approved`
      : `Uploaded ${new Date(capture.createdAt).toLocaleDateString()}`,
    ariaLabel: `Unidentified record — ${state.label}`,
    confirmText: "This unidentified upload and its photos will move to the trash. You can restore it for 30 days.",
    unidentified: { ...state, pulsing: capture.status === "processing" },
  };
}

/**
 * One grid card (catalog entry or unidentified upload). Normally a link with a
 * trash button (on hover, always on touch screens); in selection mode the whole
 * card toggles selection instead of navigating.
 */
function GridCard({
  imageUrl,
  title,
  subtitle,
  ariaLabel,
  confirmText,
  unidentified,
  href,
  selecting,
  selected,
  onToggle,
  onTrash,
}: CardContent & {
  href: string;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onTrash: () => void;
}) {
  const body = (
    <>
      <div
        className={cn(
          "relative aspect-square overflow-hidden rounded-lg border bg-muted transition-shadow",
          unidentified && "border-dashed border-input",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={unidentified ? "" : ariaLabel}
            className={cn(
              "h-full w-full object-cover transition-transform",
              !selecting && "group-hover:scale-105",
              unidentified && "opacity-80",
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Disc3 className="size-8" aria-hidden />
          </div>
        )}
        {unidentified && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-sm bg-background/90 px-2 py-1 font-mono text-[11px] font-medium text-foreground shadow-sm backdrop-blur">
            <span className={cn("size-2 rounded-full", unidentified.dot, unidentified.pulsing && "animate-pulse")} />
            {unidentified.label}
          </span>
        )}
        {selecting && (
          <span
            className={cn(
              "absolute right-2 top-2 flex size-6 items-center justify-center rounded-sm border-2 shadow-sm",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-white/90 bg-black/30",
            )}
          >
            {selected && <Check className="size-4" strokeWidth={3} />}
          </span>
        )}
      </div>
      <div>
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-sm text-muted-foreground">{subtitle}</div>
      </div>
    </>
  );

  if (selecting) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={`${selected ? "Deselect" : "Select"} ${ariaLabel}`}
        className="group block space-y-2 rounded-lg text-left outline-none ring-ring focus-visible:ring-2"
      >
        {body}
      </button>
    );
  }

  return (
    <div className="group relative">
      <Link
        to={href}
        aria-label={ariaLabel}
        className="block space-y-2 rounded-lg outline-none ring-ring focus-visible:ring-2"
      >
        {body}
      </Link>
      {/* Outside the link so clicking it doesn't navigate. */}
      <ConfirmDialog
        trigger={
          <Button
            variant="secondary"
            size="icon"
            aria-label={`Move ${ariaLabel} to trash`}
            className="absolute right-2 top-2 size-8 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-90"
          >
            <Trash2 className="size-4" />
          </Button>
        }
        title="Move to trash?"
        description={confirmText}
        confirmLabel="Move to trash"
        destructive
        onConfirm={onTrash}
      />
    </div>
  );
}
