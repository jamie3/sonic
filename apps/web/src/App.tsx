import { useQueryClient } from "@tanstack/react-query";
import { Disc3 } from "lucide-react";
import { useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { authClient, authErrorMessage } from "./api.js";
import { ModeToggle } from "@/components/mode-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { CatalogEntryEditPage } from "@/pages/CatalogEntryEditPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { RecordDetailPage } from "@/pages/RecordDetailPage";
import { ReviewQueuePage } from "@/pages/ReviewQueuePage";
import { TrashPage } from "@/pages/TrashPage";

/** Minimum password length — mirrors the server (apps/server/src/auth.ts). */
export const PASSWORD_MIN = 10;

export function App() {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (isPending) return null; // one local round-trip
  if (!session) return <AuthScreen />;

  const onLogout = async () => {
    await authClient.signOut().catch(() => {});
    // Nothing of this user's may linger for whoever signs in next.
    queryClient.clear();
    navigate("/", { replace: true });
    logger.info("logged out");
  };

  return (
    <Routes>
      <Route path="/" element={<CatalogPage onLogout={onLogout} />} />
      <Route path="/review" element={<ReviewQueuePage onLogout={onLogout} />} />
      <Route path="/catalog/:id" element={<RecordDetailPage onLogout={onLogout} />} />
      <Route path="/catalog/:id/edit" element={<CatalogEntryEditPage onLogout={onLogout} />} />
      <Route path="/trash" element={<TrashPage onLogout={onLogout} />} />
      <Route path="/profile" element={<ProfilePage onLogout={onLogout} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Signed out: sign in, or create an account with an invite code (/signup?invite=…). */
function AuthScreen() {
  const location = useLocation();
  const [mode, setMode] = useState<"signin" | "signup">(location.pathname === "/signup" ? "signup" : "signin");

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-muted/40 p-4">
      {/* Faint engineering grid backdrop. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <Card className="relative w-full max-w-sm gap-0 overflow-hidden py-0 shadow-lg">
        <div className="retro-stripe h-4" />
        <CardHeader className="gap-3 border-b px-6 py-6">
          <div className="flex items-center justify-between">
            <span className="flex size-9 items-center justify-center rounded-sm bg-foreground text-background">
              <Disc3 className="size-5" />
            </span>
            <span className="label-mono">Vinyl Catalog</span>
          </div>
          <div>
            <CardTitle className="font-mono text-xl uppercase tracking-[0.2em]">Sonic</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signin" ? "Sign in to your collection" : "Create your account — you’ll need an invite code"}
            </p>
          </div>
          <div role="tablist" aria-label="Account" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            {(
              [
                ["signin", "Sign in"],
                ["signup", "Create account"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-sm px-2 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  mode === m ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-6 py-6">{mode === "signin" ? <SignInForm /> : <SignUpForm />}</CardContent>
      </Card>
    </div>
  );
}

function SignInForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await authClient.signIn.username({ username: username.trim(), password });
    setSubmitting(false);
    if (error) {
      logger.warn({ status: error.status, username }, "sign-in failed");
      setError(error.status === 401 ? "Invalid username or password" : authErrorMessage(error, "Sign-in failed — try again"));
      return;
    }
    queryClient.clear();
    navigate("/", { replace: true });
    logger.info({ username }, "signed in");
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field id="username" label="Username">
        <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </Field>
      <Field id="password" label="Password">
        <PasswordInput
          id="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting} className="mt-2 w-full">
        {submitting ? "Signing in…" : "Log in"}
      </Button>
    </form>
  );
}

function SignUpForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    inviteCode: params.get("invite") ?? "",
    username: "",
    email: "",
    password: "",
    confirm: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const usernameBad = form.username.length > 0 && !/^[A-Za-z0-9_.]{3,30}$/.test(form.username);
  const tooShort = form.password.length > 0 && form.password.length < PASSWORD_MIN;
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const invalid =
    !form.inviteCode.trim() || !form.username || usernameBad || !form.email || form.password.length < PASSWORD_MIN || form.confirm !== form.password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setError(null);
    setSubmitting(true);
    const { error } = await authClient.signUp.email({
      email: form.email.trim(),
      password: form.password,
      name: form.username.trim(),
      username: form.username.trim(),
      // Checked (and used up) by the server; not stored on the account.
      inviteCode: form.inviteCode.trim(),
    } as Parameters<typeof authClient.signUp.email>[0]);
    setSubmitting(false);
    if (error) {
      logger.warn({ status: error.status }, "sign-up failed");
      setError(authErrorMessage(error, "Couldn’t create the account — try again"));
      return;
    }
    queryClient.clear();
    navigate("/", { replace: true });
    logger.info({ username: form.username }, "account created");
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field id="invite" label="Invite code">
        <Input
          id="invite"
          autoComplete="off"
          placeholder="SONIC-XXXX-XXXX"
          className="font-mono uppercase"
          value={form.inviteCode}
          onChange={set("inviteCode")}
          required
        />
      </Field>
      <Field id="new-username" label="Username" hint={usernameBad ? "3–30 letters, numbers, _ or ." : undefined} bad={usernameBad}>
        <Input id="new-username" autoComplete="username" value={form.username} onChange={set("username")} aria-invalid={usernameBad || undefined} required />
      </Field>
      <Field id="email" label="Email">
        <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
      </Field>
      <Field id="new-password" label="Password" hint={`At least ${PASSWORD_MIN} characters.`} bad={tooShort}>
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          value={form.password}
          onChange={set("password")}
          aria-invalid={tooShort || undefined}
          required
        />
      </Field>
      <Field id="confirm" label="Confirm password" hint={mismatch ? "Doesn’t match." : undefined} bad={mismatch}>
        <PasswordInput
          id="confirm"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set("confirm")}
          aria-invalid={mismatch || undefined}
          required
        />
      </Field>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={invalid || submitting} className="mt-2 w-full">
        {submitting ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  bad,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  bad?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="label-mono">
        {label}
      </Label>
      {children}
      {hint && <p className={cn("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>{hint}</p>}
    </div>
  );
}
