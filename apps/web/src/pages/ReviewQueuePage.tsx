import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText, Layers, Loader2, RefreshCw, RotateCcw, ScanLine, SearchX } from "lucide-react";
import { useState } from "react";
import type { Capture, FieldAgreement, IdentificationCandidate, ManualRelease } from "@sonic/shared";
import { api } from "@/api";
import { AppHeader } from "@/components/AppHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PENDING_KEY = ["captures", "pending"] as const;

/** Everything that shows captures or the catalog refreshes after an approval. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["captures"] }); // pending + unidentified
    queryClient.invalidateQueries({ queryKey: ["catalog"] });
    queryClient.invalidateQueries({ queryKey: ["tags"] });
  };
}

/**
 * Review queue. Flow: the extractor reads the photos ("Checking Discogs…"),
 * the matcher searches Discogs and quality-checks candidates, then the owner
 * approves — a Discogs match, or the AI's reading (corrected) when there's
 * no match. Approved captures leave the queue and appear in the catalog.
 * "Re-scan" sends captures back to the matcher to search Discogs again.
 */
export function ReviewQueuePage({ onLogout }: { onLogout: () => void }) {
  const refresh = useRefresh();
  const { data, isLoading, isError } = useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => api.listPending(),
    // Poll while anything is still being matched.
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === "review") ? 4000 : false),
  });

  // Selection for bulk approval — only `pending_single` captures are eligible.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const bulkApprove = useMutation({
    mutationFn: (ids: string[]) => api.approveBulk({ captureIds: ids }),
    onSuccess: () => {
      refresh();
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

  // Re-scan: send every capture awaiting a decision back to the matcher.
  const rescanAll = useMutation({
    mutationFn: (ids: string[]) => api.rescanBulk({ captureIds: ids }),
    onSuccess: () => {
      refresh();
      setSelected(new Set());
    },
  });
  const decisionIds = (data ?? []).filter((c) => c.status.startsWith("pending_")).map((c) => c.id);

  const singleIds = (data ?? []).filter((c) => c.status === "pending_single").map((c) => c.id);
  const allSelected = singleIds.length > 0 && singleIds.every((id) => selected.has(id));

  return (
    <div className="min-h-svh bg-background">
      <AppHeader onLogout={onLogout}>
        <h1 className="truncate text-base font-semibold tracking-tight">Review</h1>
        {data && data.length > 0 && (
          <Badge variant="secondary" className="font-mono tabular-nums">
            {data.length}
          </Badge>
        )}
      </AppHeader>

      <main className="mx-auto max-w-4xl px-6 py-6">
        {decisionIds.length > 0 && (
          <div className="mb-4 flex items-center justify-end gap-3">
            <p className="hidden text-xs text-muted-foreground sm:block">
              Search Discogs again with what was read from the photos
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={rescanAll.isPending}
              onClick={() => rescanAll.mutate(decisionIds)}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", rescanAll.isPending && "animate-spin")} />
              {rescanAll.isPending ? "Re-scanning…" : `Re-scan all (${decisionIds.length})`}
            </Button>
          </div>
        )}

        {singleIds.length > 0 && (
          <div className="mb-4 flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(singleIds))}
              />
              Select all confident matches ({singleIds.length})
            </label>
            <Button
              size="sm"
              disabled={selected.size === 0 || bulkApprove.isPending}
              onClick={() => bulkApprove.mutate([...selected])}
            >
              <Check className="h-4 w-4" />
              {bulkApprove.isPending ? "Approving…" : `Approve ${selected.size || ""}`.trim()}
            </Button>
          </div>
        )}

        {rescanAll.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>Couldn’t send those captures back to the matcher. Try again.</AlertDescription>
          </Alert>
        )}

        {bulkApprove.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>Couldn’t approve those captures. Try again.</AlertDescription>
          </Alert>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertDescription>Couldn’t load the review queue. Is the API server running?</AlertDescription>
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
                New captures land here once their photos have been read.
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
  const refresh = useRefresh();
  // For a multiple-match capture, the owner picks one; default to the top rank.
  const [chosen, setChosen] = useState<string>(capture.candidates[0]?.id ?? "");
  // "None of these are right — use what was read."
  const [manual, setManual] = useState(false);

  const approve = useMutation({
    mutationFn: (candidateId?: string) => api.approve(capture.id, { candidateId }),
    onSuccess: refresh,
  });
  const rescan = useMutation({ mutationFn: () => api.rescan(capture.id), onSuccess: refresh });

  const pending = capture.status.startsWith("pending_");
  const hasCandidates = capture.candidates.length > 0;

  return (
    <Card className={cn(selected && "ring-2 ring-ring")}>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row">
        <PhotoStrip capture={capture} />

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center gap-2">
            <StatusBadge capture={capture} />
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(capture.createdAt).toLocaleDateString()}
            </span>
            {pending && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                title="Search Discogs again with what was read from the photos"
                disabled={rescan.isPending}
                onClick={() => rescan.mutate()}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", rescan.isPending && "animate-spin")} />
                Re-scan
              </Button>
            )}
          </div>
          {rescan.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                Couldn’t re-scan: {rescan.error instanceof Error ? rescan.error.message : "try again"}
              </AlertDescription>
            </Alert>
          )}

          {/* Stage 1 done, stage 2 running: show what was read while Discogs is checked. */}
          {capture.status === "review" && <ExtractionPanel capture={capture} />}

          {/* Candidates with the quality check. */}
          {pending && hasCandidates && !manual && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {capture.status === "pending_single"
                  ? "Discogs match — check it agrees with what was read, then approve."
                  : `${capture.candidates.length} possible Discogs matches — pick the right one.`}
              </p>
              {capture.match?.message && <p className="text-xs text-muted-foreground">{capture.match.message}</p>}
              <div className="space-y-1.5">
                {capture.candidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-2.5",
                      chosen === candidate.id ? "border-primary bg-accent" : "hover:bg-muted/50",
                    )}
                  >
                    {capture.status === "pending_single" && capture.candidates.length === 1 ? (
                      <input
                        type="checkbox"
                        aria-label="Select for bulk approval"
                        className="mt-1 size-4 accent-primary"
                        checked={selected}
                        onChange={onToggleSelect}
                      />
                    ) : (
                      <input
                        type="radio"
                        name={`candidate-${capture.id}`}
                        className="mt-1 size-4 accent-primary"
                        checked={chosen === candidate.id}
                        onChange={() => setChosen(candidate.id)}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <CandidateRow candidate={candidate} />
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!chosen || approve.isPending} onClick={() => approve.mutate(chosen)}>
                  <Check className="h-4 w-4" />
                  {approve.isPending ? "Approving…" : "Approve match"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setManual(true)}>
                  None of these are right — use what was read
                </Button>
              </div>
            </div>
          )}

          {/* No match (or owner rejected the candidates): approve the AI's reading, corrected. */}
          {pending && (!hasCandidates || manual) && (
            <div className="space-y-3">
              <MatchNote capture={capture} />
              {capture.extraction?.error && <ExtractionPanel capture={capture} />}
              <ManualApproveForm
                capture={capture}
                onCancel={hasCandidates ? () => setManual(false) : undefined}
              />
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

/** Why there are no candidates: nothing found, Discogs not configured, or an error. */
function MatchNote({ capture }: { capture: Capture }) {
  const m = capture.match;
  if (!m) return null;
  const tone = m.outcome === "error" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className={cn("rounded-md border border-dashed p-3 text-sm", tone)}>
      {m.message ?? (m.outcome === "matched" ? "Matched on Discogs." : "No match found.")}
      {m.queries.length > 0 && (
        <div className="label-mono mt-1">Searched: {m.queries.join(" · ")}</div>
      )}
      <div className="mt-1 text-xs">Check the details below, correct anything wrong, and approve.</div>
    </div>
  );
}

/** The AI's reading, editable, approved as a hand-confirmed release. */
function ManualApproveForm({ capture, onCancel }: { capture: Capture; onCancel?: () => void }) {
  const refresh = useRefresh();
  const f = capture.extraction?.fields;
  const [form, setForm] = useState({
    artist: f?.artist ?? "",
    title: f?.title ?? "",
    label: f?.label ?? "",
    catalogNumber: f?.catalogNumber ?? "",
    barcode: f?.barcode ?? capture.barcodeHint ?? "",
    year: f?.year != null ? String(f.year) : "",
    country: f?.country ?? "",
    format: f?.format ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const resolve = useMutation({
    mutationFn: () => {
      const manual: ManualRelease = {
        artist: form.artist.trim(),
        title: form.title.trim(),
        label: form.label.trim() || null,
        catalogNumber: form.catalogNumber.trim() || null,
        barcode: form.barcode.trim() || null,
        year: form.year ? Number(form.year) : null,
        country: form.country.trim() || null,
        format: form.format.trim() || null,
        tracklist: f?.tracklist ?? [],
      };
      return api.resolve(capture.id, { manual });
    },
    onSuccess: refresh,
  });

  const invalid = !form.artist.trim() || !form.title.trim() || (form.year !== "" && !/^\d{1,4}$/.test(form.year));
  const fields: [keyof typeof form, string, boolean?][] = [
    ["artist", "Artist", true],
    ["title", "Title", true],
    ["label", "Label"],
    ["catalogNumber", "Catalog no."],
    ["barcode", "Barcode"],
    ["year", "Year"],
    ["country", "Country"],
    ["format", "Format"],
  ];

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) resolve.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(([key, label, required]) => (
          <div key={key} className="grid gap-1">
            <Label htmlFor={`${capture.id}-${key}`} className="label-mono">
              {label}
              {required && <span className="text-destructive"> *</span>}
            </Label>
            <Input
              id={`${capture.id}-${key}`}
              value={form[key]}
              onChange={set(key)}
              inputMode={key === "year" || key === "barcode" ? "numeric" : undefined}
            />
          </div>
        ))}
      </div>
      {f && f.tracklist.length > 0 && (
        <p className="text-xs text-muted-foreground">{f.tracklist.length} tracks read from the photos will be kept.</p>
      )}
      {resolve.isError && (
        <Alert variant="destructive">
          <AlertDescription>Couldn’t approve this capture. Try again.</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={invalid || resolve.isPending}>
          <Check className="h-4 w-4" />
          {resolve.isPending ? "Approving…" : "Approve to catalog"}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Back to Discogs matches
          </Button>
        )}
      </div>
    </form>
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
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No photo</div>
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

const FIELD_LABEL: Record<FieldAgreement["field"], string> = {
  barcode: "Barcode",
  catalogNumber: "Cat. no.",
  artist: "Artist",
  title: "Title",
  label: "Label",
  year: "Year",
};

/** A Discogs candidate with its quality check: score + per-field agreement. */
function CandidateRow({ candidate }: { candidate: IdentificationCandidate }) {
  const { release } = candidate;
  const meta = [release.year, release.country, release.label, release.catalogNumber].filter(Boolean).join(" · ");
  const compared = candidate.agreement.filter((a) => a.agreement !== "missing");
  return (
    <div className="flex items-start gap-3">
      {release.thumbUrl && (
        <img src={release.thumbUrl} alt="" className="size-12 shrink-0 rounded border object-cover" />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {release.artist} — {release.title}
            </div>
            {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
            {release.format && <div className="truncate text-xs text-muted-foreground">{release.format}</div>}
          </div>
          {candidate.score != null && <ScoreBadge score={candidate.score} />}
        </div>
        {compared.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {compared.map((a) => (
              <span
                key={a.field}
                title={`Read: ${a.extracted ?? "—"} · Discogs: ${a.candidate ?? "—"}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px]",
                  a.agreement === "match" && "bg-avocado-green/15 text-foreground",
                  a.agreement === "partial" && "bg-mustard-yellow/20 text-foreground",
                  a.agreement === "mismatch" && "bg-rust-red/15 text-foreground",
                )}
              >
                {a.agreement === "match" ? "✓" : a.agreement === "partial" ? "≈" : "✗"} {FIELD_LABEL[a.field]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium",
        pct >= 75 ? "bg-avocado-green/20" : pct >= 50 ? "bg-mustard-yellow/25" : "bg-rust-red/15",
      )}
      title="How well this Discogs release agrees with what was read from the photos"
    >
      {pct}% match
    </span>
  );
}

function StatusBadge({ capture }: { capture: Capture }) {
  switch (capture.status) {
    case "review":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking Discogs…
        </Badge>
      );
    case "pending_single":
      return (
        <Badge variant="secondary" className="gap-1">
          <ScanLine className="h-3 w-3" />
          Match found
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
          {capture.match?.outcome === "skipped" ? "Ready to approve" : "No Discogs match"}
        </Badge>
      );
    default:
      return <Badge variant="outline">{capture.status}</Badge>;
  }
}

/**
 * What the extractor read off the photos: the structured fields, plus the full
 * transcription on demand.
 */
function ExtractionPanel({ capture }: { capture: Capture }) {
  const refresh = useRefresh();
  const readAgain = useMutation({ mutationFn: () => api.readAgain(capture.id), onSuccess: refresh });
  const x = capture.extraction;
  if (!x) return null;
  const readAgainButton = (
    <Button variant="outline" size="sm" disabled={readAgain.isPending} onClick={() => readAgain.mutate()}>
      <RotateCcw className="h-3.5 w-3.5" />
      {readAgain.isPending ? "Sending…" : "Read photos again"}
    </Button>
  );
  if (x.error) {
    return (
      <div className="space-y-2">
        <Alert variant="destructive">
          <AlertDescription>The extractor couldn’t read these photos: {x.error}</AlertDescription>
        </Alert>
        {readAgainButton}
      </div>
    );
  }
  const f = x.fields;
  const rows: [string, string | number | null][] = [
    ["Artist", f.artist],
    ["Title", f.title],
    ["Label", f.label],
    ["Catalog no.", f.catalogNumber],
    ["Barcode", f.barcode],
    ["Year", f.year],
    ["Country", f.country],
    ["Format", f.format],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="label-mono self-center">{k}</dt>
            <dd className={cn("truncate", v == null && "text-muted-foreground")}>{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {f.tracklist.length > 0 && (
        <details className="text-sm">
          <summary className="label-mono cursor-pointer">Tracklist ({f.tracklist.length})</summary>
          <ol className="mt-2 space-y-0.5">
            {f.tracklist.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{t.position ?? ""}</span>
                <span>{t.title}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {x.rawText && (
        <details className="text-sm">
          <summary className="label-mono cursor-pointer">All text read from the photos</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono text-xs">
            {x.rawText}
          </pre>
        </details>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <FileText className="mr-1 inline h-3 w-3" />
          Read by {x.engine}
          {x.model ? ` (${x.model})` : ""}
        </p>
        {readAgainButton}
      </div>
    </div>
  );
}
