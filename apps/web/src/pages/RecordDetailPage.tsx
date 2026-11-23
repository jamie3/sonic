import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Disc3, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SonicApiError } from "@sonic/api-client";
import type { CatalogEntry, PhotoType } from "@sonic/shared";
import { api } from "@/api";
import { AppHeader } from "@/components/AppHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ImageLightbox, type LightboxImage } from "@/components/ImageLightbox";
import type { TrashedState } from "@/pages/CatalogPage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export function RecordDetailPage({ onLogout }: { onLogout: () => void }) {
  const { id = "" } = useParams();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["catalog-entry", id],
    queryFn: () => api.getCatalogEntry(id),
    enabled: !!id,
    retry: (count, err) =>
      err instanceof SonicApiError && err.status === 404 ? false : count < 3,
  });
  const notFound = error instanceof SonicApiError && error.status === 404;

  return (
    <div className="min-h-svh bg-background">
      <AppHeader onLogout={onLogout}>
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          Catalog
        </Link>
      </AppHeader>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to catalog
        </Link>

        {notFound ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm font-medium">Record not found</p>
            <p className="text-sm text-muted-foreground">
              This record doesn’t exist or was removed.
            </p>
          </div>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn’t load this record.</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <DetailSkeleton />
        ) : data ? (
          <RecordDetail entry={data} />
        ) : null}
      </main>
    </div>
  );
}

/** Captions for the owner's photos in the image viewer. */
const PHOTO_LABELS: Record<PhotoType, string> = {
  front: "Front",
  back: "Back",
  label_a: "Label — side A",
  label_b: "Label — side B",
  spine: "Spine",
};

function RecordDetail({ entry }: { entry: CatalogEntry }) {
  const { release } = entry;

  // Every image of this record, in viewer order: the Discogs cover, then the photos.
  const images: LightboxImage[] = [
    ...(release.coverUrl ? [{ src: release.coverUrl, label: "Cover (Discogs)" }] : []),
    ...entry.photos.map((p) => ({ src: p.url, label: PHOTO_LABELS[p.type] ?? p.type })),
  ];
  const photoOffset = release.coverUrl ? 1 : 0;
  const [viewing, setViewing] = useState<number | null>(null);

  // Main image: the Discogs cover, else the owner's front photo, else any
  // photo. One that fails to load (e.g. a dead Discogs URL) falls through to
  // the next; with nothing left, a record graphic.
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const frontIndex = entry.photos.findIndex((p) => p.type === "front");
  const order = [
    ...(release.coverUrl ? [0] : []),
    ...(frontIndex >= 0 ? [photoOffset + frontIndex] : []),
    ...entry.photos.map((_, i) => photoOffset + i),
  ];
  const heroIndex = order.find((i) => images[i] && !failed.has(images[i]!.src));
  const hero = heroIndex !== undefined ? images[heroIndex] : undefined;

  return (
    <div className="grid gap-8 md:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
          {hero ? (
            <button
              type="button"
              onClick={() => setViewing(heroIndex!)}
              aria-label={`View ${hero.label.toLowerCase()} full size`}
              className="block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-ring"
            >
              <img
                key={hero.src}
                src={hero.src}
                alt={`${release.artist} — ${release.title}`}
                onError={() => setFailed((prev) => new Set(prev).add(hero.src))}
                className="h-full w-full object-cover transition-opacity hover:opacity-90"
              />
            </button>
          ) : (
            <div
              role="img"
              aria-label={`${release.artist} — ${release.title} (no image)`}
              className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted to-accent text-muted-foreground"
            >
              <Disc3 className="size-20 opacity-40" strokeWidth={1.25} />
              <span className="max-w-[80%] truncate text-center text-sm font-medium">{release.title}</span>
            </div>
          )}
        </div>

        {entry.photos.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {entry.photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewing(photoOffset + i)}
                aria-label={`View photo: ${PHOTO_LABELS[p.type] ?? p.type}`}
                title={PHOTO_LABELS[p.type] ?? p.type}
                className="cursor-zoom-in overflow-hidden rounded-md border focus-visible:outline-2 focus-visible:outline-ring"
              >
                <img
                  src={p.url}
                  alt={PHOTO_LABELS[p.type] ?? p.type}
                  className="aspect-square w-full object-cover transition-opacity hover:opacity-90"
                />
              </button>
            ))}
          </div>
        )}

        <ImageLightbox
          images={images}
          index={viewing}
          onIndexChange={setViewing}
          onClose={() => setViewing(null)}
          title={`${release.artist} — ${release.title}: images`}
        />
      </div>

      <div className="space-y-8">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{release.title}</h1>
              <p className="mt-1 text-lg text-muted-foreground">{release.artist}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/catalog/${entry.id}/edit`}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Link>
              </Button>
              <MoveToTrash entry={entry} />
            </div>
          </div>
          {entry.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tags">
              {entry.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    to={`/?tag=${encodeURIComponent(tag)}`}
                    title={`Show everything tagged “${tag}”`}
                    className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Badge variant="secondary" className="hover:bg-accent">
                      <Tag className="size-3" />
                      {tag}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Section title="Release">
          <Field label="Label" value={release.label} />
          <Field label="Catalog number" value={release.catalogNumber} />
          <Field label="Year" value={release.year?.toString()} />
          <Field label="Country" value={release.country} />
          <Field label="Format" value={release.format} />
          <Field label="Barcode" value={release.barcode} mono />
          <Field label="Source" value={`${release.source} · ${release.sourceId}`} />
        </Section>

        <Section title="Copy">
          <Field label="Condition" value={entry.condition} />
          <Field label="Location" value={entry.location} />
          <Field
            label="Purchase price"
            value={entry.purchasePrice != null ? `$${entry.purchasePrice.toFixed(2)}` : null}
          />
          <Field
            label="Purchase date"
            value={
              entry.purchaseDate
                ? new Date(entry.purchaseDate).toLocaleDateString()
                : null
            }
          />
          <Field
            label="Added"
            value={new Date(entry.approvedAt).toLocaleDateString()}
          />
        </Section>

        <NotesEditor entry={entry} />

        {release.tracklist.length > 0 && (
          <Section title="Tracklist" plain>
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {release.tracklist.map((t, i) => (
                    <li key={i} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                      <span className="w-10 shrink-0 font-mono text-muted-foreground">
                        {t.position}
                      </span>
                      <span className="flex-1">{t.title}</span>
                      {t.duration && (
                        <span className="font-mono text-muted-foreground">{t.duration}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </Section>
        )}
      </div>
    </div>
  );
}

/** Soft-deletes the record and returns to the catalog, which offers Undo. */
function MoveToTrash({ entry }: { entry: CatalogEntry }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const trash = useMutation({
    mutationFn: () => api.trashCatalogEntry(entry.id),
    onSuccess: () => {
      for (const key of [["catalog"], ["tags"], ["trash"]]) queryClient.invalidateQueries({ queryKey: key });
      const state: TrashedState = {
        trashed: { items: [{ kind: "entry", id: entry.id }], label: `“${entry.release.title}”` },
      };
      navigate("/", { state });
    },
  });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm" disabled={trash.isPending} aria-label="Move to trash">
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{trash.isPending ? "Moving…" : "Move to trash"}</span>
        </Button>
      }
      title="Move to trash?"
      description={`“${entry.release.title}” will be removed from your catalog. You can restore it from the Trash for 30 days, after which it's deleted for good.`}
      confirmLabel="Move to trash"
      destructive
      onConfirm={() => trash.mutate()}
    />
  );
}

function NotesEditor({ entry }: { entry: CatalogEntry }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.notes ?? "");

  const mutation = useMutation({
    mutationFn: (notes: string | null) => api.updateCatalogEntry(entry.id, { notes }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["catalog-entry", entry.id], updated);
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      setEditing(false);
    },
  });

  const startEditing = () => {
    setDraft(entry.notes ?? "");
    setEditing(true);
  };

  if (editing) {
    return (
      <Section title="Notes" plain>
        <Textarea
          autoFocus
          rows={4}
          placeholder="Add a note about this copy…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={mutation.isPending}
        />
        {mutation.isError && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>Couldn’t save the note. Try again.</AlertDescription>
          </Alert>
        )}
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            onClick={() => mutation.mutate(draft.trim() || null)}
            disabled={mutation.isPending || draft.trim() === (entry.notes ?? "")}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Notes" plain>
      {entry.notes ? (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap text-sm">{entry.notes}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={startEditing}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => mutation.mutate(null)}
              disabled={mutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={startEditing}>
          <Plus className="h-3.5 w-3.5" />
          Add a note
        </Button>
      )}
    </Section>
  );
}

function Section({
  title,
  children,
  plain,
}: {
  title: string;
  children: React.ReactNode;
  plain?: boolean;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {plain ? children : <dl className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</dl>}
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  full?: boolean;
}) {
  if (!value) return null;
  return (
    <div className={full ? "col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-8 md:grid-cols-[320px_1fr]">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <div className="space-y-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
