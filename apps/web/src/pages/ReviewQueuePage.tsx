import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Layers, ScanLine, SearchX } from "lucide-react";
import { useState } from "react";
import type { Capture, IdentificationCandidate } from "@sonic/shared";
import { api } from "@/api";
import { AppHeader } from "@/components/AppHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PENDING_KEY = ["captures", "pending"] as const;

export function ReviewQueuePage({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => api.listPending(),
  });

  // Selection for bulk approval — only `pending_single` captures are eligible.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const bulkApprove = useMutation({
    mutationFn: (ids: string[]) => api.approveBulk({ captureIds: ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PENDING_KEY });
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      setSelected(new Set());
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const singleIds = (data ?? [])
    .filter((c) => c.status === "pending_single")
    .map((c) => c.id);
  const allSelected = singleIds.length > 0 && singleIds.every((id) => selected.has(id));

  return (
    <div className="min-h-svh bg-background">
      <AppHeader onLogout={onLogout}>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-xl font-semibold tracking-tight">Review</h1>
        {data && data.length > 0 && <Badge variant="secondary">{data.length}</Badge>}
      </AppHeader>

      <main className="mx-auto max-w-4xl px-6 py-6">
        {singleIds.length > 0 && (
          <div className="mb-4 flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(singleIds))
                }
              />
              Select all confident matches ({singleIds.length})
            </label>
            <Button
              size="sm"
              disabled={selected.size === 0 || bulkApprove.isPending}
              onClick={() => bulkApprove.mutate([...selected])}
            >
              <Check className="h-4 w-4" />
              {bulkApprove.isPending
                ? "Approving…"
                : `Approve ${selected.size || ""}`.trim()}
            </Button>
          </div>
        )}

        {bulkApprove.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>Couldn’t approve those captures. Try again.</AlertDescription>
          </Alert>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Couldn’t load the review queue. Is the API server running?
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <div className="space-y-4">
            {data.map((capture) => (
              <CaptureCard
                key={capture.id}
                capture={capture}
                selected={selected.has(capture.id)}
                onToggleSelect={() => toggle(capture.id)}
              />
            ))}
          </div>
        ) : (
          !isError && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <Check className="mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing to review</p>
              <p className="text-sm text-muted-foreground">
                New captures land here once recognition finishes.
              </p>
            </div>
          )
        )}
      </main>
    </div>
  );
}

function CaptureCard({
  capture,
  selected,
  onToggleSelect,
}: {
  capture: Capture;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const queryClient = useQueryClient();
  // For a multiple-match capture, the owner picks one; default to the top rank.
  const [chosen, setChosen] = useState<string>(capture.candidates[0]?.id ?? "");

  const approve = useMutation({
    mutationFn: (candidateId?: string) => api.approve(capture.id, { candidateId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PENDING_KEY });
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  const method = capture.candidates[0]?.method;

  return (
    <Card className={cn(selected && "ring-2 ring-ring")}>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row">
        <PhotoStrip capture={capture} />

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <StatusBadge capture={capture} />
            {method && (
              <span className="text-xs text-muted-foreground">via {method}</span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(capture.createdAt).toLocaleDateString()}
            </span>
          </div>

          {capture.status === "pending_single" && capture.candidates[0] && (
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label="Select for bulk approval"
                className="mt-1 size-4 accent-primary"
                checked={selected}
                onChange={onToggleSelect}
              />
              <div className="min-w-0 flex-1">
                <CandidateRow candidate={capture.candidates[0]} />
              </div>
              <Button
                size="sm"
                disabled={approve.isPending}
                onClick={() => approve.mutate(undefined)}
              >
                <Check className="h-4 w-4" />
                {approve.isPending ? "Approving…" : "Approve"}
              </Button>
            </div>
          )}

          {capture.status === "pending_multiple" && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {capture.candidates.length} possible matches — pick the right one.
              </p>
              <div className="space-y-1.5">
                {capture.candidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-2.5",
                      chosen === candidate.id
                        ? "border-primary bg-accent"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <input
                      type="radio"
                      name={`candidate-${capture.id}`}
                      className="mt-1 size-4 accent-primary"
                      checked={chosen === candidate.id}
                      onChange={() => setChosen(candidate.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <CandidateRow candidate={candidate} />
                    </div>
                  </label>
                ))}
              </div>
              <Button
                size="sm"
                disabled={!chosen || approve.isPending}
                onClick={() => approve.mutate(chosen)}
              >
                <Check className="h-4 w-4" />
                {approve.isPending ? "Approving…" : "Approve selected"}
              </Button>
            </div>
          )}

          {capture.status === "pending_nomatch" && (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No match found. Manual metadata entry isn’t available yet — this
              capture will stay here until that flow is built.
            </div>
          )}

          {approve.isError && (
            <Alert variant="destructive">
              <AlertDescription>Couldn’t approve this capture. Try again.</AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PhotoStrip({ capture }: { capture: Capture }) {
  const cover = capture.photos.find((p) => p.type === "front") ?? capture.photos[0];
  return (
    <div className="w-full shrink-0 sm:w-40">
      <div className="aspect-square overflow-hidden rounded-md border bg-muted">
        {cover ? (
          <img src={cover.url} alt={cover.type} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No photo
          </div>
        )}
      </div>
      {capture.photos.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {capture.photos.map((p) => (
            <span key={p.id} className="text-[10px] text-muted-foreground">
              {p.type}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: IdentificationCandidate }) {
  const { release } = candidate;
  const meta = [release.year, release.country, release.label, release.catalogNumber]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-start gap-3">
      {release.thumbUrl && (
        <img
          src={release.thumbUrl}
          alt=""
          className="size-10 shrink-0 rounded border object-cover"
        />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {release.artist} — {release.title}
        </div>
        {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
        {release.format && (
          <div className="truncate text-xs text-muted-foreground">{release.format}</div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ capture }: { capture: Capture }) {
  switch (capture.status) {
    case "pending_single":
      return (
        <Badge variant="secondary" className="gap-1">
          <ScanLine className="h-3 w-3" />1 match
        </Badge>
      );
    case "pending_multiple":
      return (
        <Badge variant="secondary" className="gap-1">
          <Layers className="h-3 w-3" />
          {capture.candidates.length} matches
        </Badge>
      );
    case "pending_nomatch":
      return (
        <Badge variant="outline" className="gap-1">
          <SearchX className="h-3 w-3" />
          No match
        </Badge>
      );
    default:
      return <Badge variant="outline">{capture.status}</Badge>;
  }
}
