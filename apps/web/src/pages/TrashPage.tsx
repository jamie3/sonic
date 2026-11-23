import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Disc3, RotateCcw, Trash2 } from "lucide-react";
import type { TrashItem, TrashKind } from "@sonic/shared";
import { api } from "@/api";
import { AppHeader } from "@/components/AppHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const DAY_MS = 86_400_000;

function daysLeft(item: TrashItem): number {
  return Math.max(0, Math.ceil((Date.parse(item.purgeAt) - Date.now()) / DAY_MS));
}

/** Everything that touches catalog contents must refresh after a trash action. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const key of [["trash"], ["catalog"], ["captures"], ["tags"], ["catalog-entry"]]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
}

export function TrashPage({ onLogout }: { onLogout: () => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["trash"], queryFn: () => api.listTrash() });
  const invalidate = useInvalidateAll();

  const restore = useMutation({
    mutationFn: ({ kind, id }: { kind: TrashKind; id: string }) => api.restoreFromTrash(kind, id),
    onSuccess: invalidate,
  });
  const forever = useMutation({
    mutationFn: ({ kind, id }: { kind: TrashKind; id: string }) => api.deleteForever(kind, id),
    onSuccess: invalidate,
  });
  const empty = useMutation({ mutationFn: () => api.emptyTrash(), onSuccess: invalidate });

  const items = data?.items ?? [];
  const busyId = (restore.isPending && restore.variables?.id) || (forever.isPending && forever.variables?.id);

  return (
    <div className="min-h-svh bg-background">
      <AppHeader onLogout={onLogout}>
        <h1 className="truncate text-base font-semibold tracking-tight">Trash</h1>
        {items.length > 0 && (
          <Badge variant="secondary" className="font-mono tabular-nums">
            {items.length}
          </Badge>
        )}
      </AppHeader>

      <main className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Items are permanently deleted {data?.retentionDays ?? 30} days after being moved here.
          </p>
          {items.length > 0 && (
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm" disabled={empty.isPending}>
                  <Trash2 className="size-4" />
                  {empty.isPending ? "Emptying…" : "Empty trash"}
                </Button>
              }
              title="Empty the trash?"
              description={`All ${items.length} item${items.length === 1 ? "" : "s"} and their photos will be permanently deleted. This can't be undone.`}
              confirmLabel="Delete forever"
              destructive
              onConfirm={() => empty.mutate()}
            />
          )}
        </div>

        {(isError || restore.isError || forever.isError || empty.isError) && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>Something went wrong. Refresh and try again.</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <Trash2 className="mb-2 size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Trash is empty</p>
            <p className="text-sm text-muted-foreground">Deleted records appear here for 30 days.</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {items.map((item) => {
              const left = daysLeft(item);
              return (
                <li key={`${item.kind}:${item.id}`} className="flex items-center gap-4 p-3">
                  <div className="size-14 shrink-0 overflow-hidden rounded-md border bg-muted">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="h-full w-full object-cover opacity-80" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <Disc3 className="size-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.title}</div>
                    <div className="truncate text-sm text-muted-foreground">{item.subtitle}</div>
                    <div className="label-mono mt-1">
                      {item.kind === "capture" ? "Unidentified · " : ""}
                      {left === 0 ? "Deleted at next cleanup" : `Deleted forever in ${left} day${left === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busyId}
                      onClick={() => restore.mutate({ kind: item.kind, id: item.id })}
                    >
                      <RotateCcw className="size-4" />
                      Restore
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm" disabled={!!busyId} aria-label={`Delete ${item.title} forever`}>
                          <Trash2 className="size-4" />
                          <span className="hidden sm:inline">Delete forever</span>
                        </Button>
                      }
                      title="Delete forever?"
                      description={`“${item.title}” and its photos will be permanently deleted. This can't be undone.`}
                      confirmLabel="Delete forever"
                      destructive
                      onConfirm={() => forever.mutate({ kind: item.kind, id: item.id })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
