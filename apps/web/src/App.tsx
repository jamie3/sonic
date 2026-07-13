import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, getToken, setToken } from "./api.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { logger } from "@/lib/logger";
import { CatalogEntryEditPage } from "@/pages/CatalogEntryEditPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { RecordDetailPage } from "@/pages/RecordDetailPage";
import { ReviewQueuePage } from "@/pages/ReviewQueuePage";

export function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  const onLogout = () => {
    setToken(null);
    setLoggedIn(false);
    logger.info("logged out");
  };

  return (
    <Routes>
      <Route path="/" element={<CatalogPage onLogout={onLogout} />} />
      <Route path="/review" element={<ReviewQueuePage onLogout={onLogout} />} />
      <Route path="/catalog/:id" element={<RecordDetailPage onLogout={onLogout} />} />
      <Route path="/catalog/:id/edit" element={<CatalogEntryEditPage onLogout={onLogout} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.login({ username, password });
      setToken(res.token);
      logger.info({ username }, "login succeeded");
      onLogin();
    } catch (err) {
      logger.warn({ err, username }, "login failed");
      setError("Invalid credentials");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Sonic</CardTitle>
          <p className="text-sm text-muted-foreground">Sign in to your vinyl catalog</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Signing in…" : "Log in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
