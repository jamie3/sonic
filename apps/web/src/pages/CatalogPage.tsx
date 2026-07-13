import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { AppHeader } from "@/components/AppHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export function CatalogPage({ onLogout }: { onLogout: () => void }) {
  const [q, setQ] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["catalog", q],
    queryFn: () => api.searchCatalog({ q: q || undefined, page: 1, pageSize: 40 }),
  });

  return (
    <div className="min-h-svh bg-background">
      <AppHeader onLogout={onLogout}>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-xl font-semibold tracking-tight">Catalog</h1>
        {data && <Badge variant="secondary">{data.total}</Badge>}
      </AppHeader>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="relative mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search artist or title…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>

        {isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Couldn’t load the catalog. Is the API server running?
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.items.map((entry) => (
              <Link
                key={entry.id}
                to={`/catalog/${entry.id}`}
                className="group space-y-2 rounded-lg outline-none ring-ring focus-visible:ring-2"
              >
                <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
                  {entry.release.coverUrl ? (
                    <img
                      src={entry.release.coverUrl}
                      alt={`${entry.release.artist} — ${entry.release.title}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No cover
                    </div>
                  )}
                </div>
                <div>
                  <div className="truncate text-sm font-medium">{entry.release.artist}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {entry.release.title}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          !isError && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm font-medium">No records found</p>
              <p className="text-sm text-muted-foreground">
                {q ? "Try a different search." : "Your catalog is empty."}
              </p>
            </div>
          )
        )}
      </main>
    </div>
  );
}
