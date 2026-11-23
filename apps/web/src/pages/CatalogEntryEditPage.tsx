import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SonicApiError } from "@sonic/api-client";
import { Condition } from "@sonic/shared";
import type { CatalogEntry } from "@sonic/shared";
import { api } from "@/api";
import { AppHeader } from "@/components/AppHeader";
import { TagInput } from "@/components/TagInput";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const NO_CONDITION = "__none__";

export function CatalogEntryEditPage({ onLogout }: { onLogout: () => void }) {
  const { id = "" } = useParams();
  const { data, isLoading, error } = useQuery({
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
        {data && (
          <>
            <span className="text-muted-foreground">/</span>
            <Link
              to={`/catalog/${id}`}
              className="max-w-[16rem] truncate text-muted-foreground hover:text-foreground"
            >
              {data.release.title}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span>Edit</span>
          </>
        )}
      </AppHeader>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <Link
          to={`/catalog/${id}`}
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to record
        </Link>

        {notFound ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm font-medium">Record not found</p>
          </div>
        ) : isLoading ? (
          <Skeleton className="h-96 w-full rounded-lg" />
        ) : data ? (
          <EditForm entry={data} />
        ) : null}
      </main>
    </div>
  );
}

type FormState = {
  artist: string;
  title: string;
  label: string;
  catalogNumber: string;
  barcode: string;
  year: string;
  country: string;
  format: string;
  coverUrl: string;
  condition: string;
  location: string;
  purchasePrice: string;
  purchaseDate: string;
  notes: string;
};

function initialState(entry: CatalogEntry): FormState {
  const r = entry.release;
  return {
    artist: r.artist ?? "",
    title: r.title ?? "",
    label: r.label ?? "",
    catalogNumber: r.catalogNumber ?? "",
    barcode: r.barcode ?? "",
    year: r.year != null ? String(r.year) : "",
    country: r.country ?? "",
    format: r.format ?? "",
    coverUrl: r.coverUrl ?? "",
    condition: entry.condition ?? "",
    location: entry.location ?? "",
    purchasePrice: entry.purchasePrice != null ? String(entry.purchasePrice) : "",
    purchaseDate: entry.purchaseDate ?? "",
    notes: entry.notes ?? "",
  };
}

function EditForm({ entry }: { entry: CatalogEntry }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialState(entry));
  const [tags, setTags] = useState<string[]>(entry.tags);
  const { data: allTags } = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: () =>
      api.updateCatalogEntry(entry.id, {
        condition: (form.condition || null) as CatalogEntry["condition"],
        location: form.location.trim() || null,
        purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : null,
        purchaseDate: form.purchaseDate || null,
        notes: form.notes.trim() || null,
        tags,
        release: {
          artist: form.artist.trim(),
          title: form.title.trim(),
          label: form.label.trim() || null,
          catalogNumber: form.catalogNumber.trim() || null,
          barcode: form.barcode.trim() || null,
          year: form.year ? Number(form.year) : null,
          country: form.country.trim() || null,
          format: form.format.trim() || null,
          coverUrl: form.coverUrl.trim() || null,
        },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["catalog-entry", entry.id], updated);
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      navigate(`/catalog/${entry.id}`);
    },
  });

  const invalid = !form.artist.trim() || !form.title.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invalid) mutation.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-8 md:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
          {form.coverUrl ? (
            <img src={form.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No cover
            </div>
          )}
        </div>
        <Field label="Cover URL">
          <Input
            value={form.coverUrl}
            onChange={(e) => set("coverUrl")(e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      <div className="space-y-8">
        <div className="grid gap-4">
          <Field label="Title" required>
            <Input value={form.title} onChange={(e) => set("title")(e.target.value)} />
          </Field>
          <Field label="Artist" required>
            <Input value={form.artist} onChange={(e) => set("artist")(e.target.value)} />
          </Field>
          <Field label="Tags — genre, style, category, group…">
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={allTags?.map((t) => t.name)}
            />
          </Field>
        </div>

        <FormSection title="Release">
          <Field label="Label">
            <Input value={form.label} onChange={(e) => set("label")(e.target.value)} />
          </Field>
          <Field label="Catalog number">
            <Input
              value={form.catalogNumber}
              onChange={(e) => set("catalogNumber")(e.target.value)}
            />
          </Field>
          <Field label="Year">
            <Input
              type="number"
              value={form.year}
              onChange={(e) => set("year")(e.target.value)}
            />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={(e) => set("country")(e.target.value)} />
          </Field>
          <Field label="Format">
            <Input value={form.format} onChange={(e) => set("format")(e.target.value)} />
          </Field>
          <Field label="Barcode">
            <Input value={form.barcode} onChange={(e) => set("barcode")(e.target.value)} />
          </Field>
        </FormSection>

        <FormSection title="Copy">
          <Field label="Condition">
            <Select
              value={form.condition || NO_CONDITION}
              onValueChange={(v) => set("condition")(v === NO_CONDITION ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONDITION}>—</SelectItem>
                {Condition.options.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => set("location")(e.target.value)} />
          </Field>
          <Field label="Purchase price">
            <Input
              type="number"
              step="0.01"
              value={form.purchasePrice}
              onChange={(e) => set("purchasePrice")(e.target.value)}
            />
          </Field>
          <Field label="Purchase date">
            <Input
              type="date"
              value={form.purchaseDate}
              onChange={(e) => set("purchaseDate")(e.target.value)}
            />
          </Field>
          <Field label="Notes" full>
            <Textarea
              rows={4}
              value={form.notes}
              onChange={(e) => set("notes")(e.target.value)}
            />
          </Field>
        </FormSection>

        {mutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>Couldn’t save changes. Try again.</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending || invalid}>
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="ghost" asChild>
            <Link to={`/catalog/${entry.id}`}>Cancel</Link>
          </Button>
        </div>
      </div>
    </form>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  required,
  full,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={`grid gap-1.5 ${full ? "col-span-2" : ""}`}>
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
