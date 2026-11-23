import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Inbox, KeyRound, Library, Plus, Ticket, Trash2, UserRound, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Invite } from "@sonic/shared";
import { api, authClient, authErrorMessage } from "@/api";
import { PASSWORD_MIN } from "@/App";
import { AppHeader } from "@/components/AppHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** The signed-in account: details, a library summary, invites, and change password. */
export function ProfilePage({ onLogout }: { onLogout: () => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["profile"], queryFn: () => api.profile() });
  const placeholderEmail = data?.email.endsWith("@users.sonic.invalid");

  return (
    <div className="min-h-svh bg-background">
      <AppHeader onLogout={onLogout}>
        <h1 className="truncate text-base font-semibold tracking-tight">Profile</h1>
      </AppHeader>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-6">
        {isError && (
          <Alert variant="destructive">
            <AlertDescription>Couldn’t load your profile. Is the API server running?</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <UserRound className="size-6" />
            </span>
            {isLoading || !data ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            ) : (
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{data.username}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {placeholderEmail ? "No email set" : data.email} · joined {date(data.createdAt)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <section aria-labelledby="library-heading" className="space-y-2">
          <h2 id="library-heading" className="label-mono">
            Library
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat to="/" icon={Library} label="In the catalog" value={data?.stats.catalog} />
            <Stat to="/review" icon={Inbox} label="Awaiting review" value={data?.stats.awaitingReview} />
            <Stat to="/trash" icon={Trash2} label="In the trash" value={data?.stats.inTrash} />
          </div>
        </section>

        <Invites />
        <ChangePassword />
      </main>
    </div>
  );
}

function Stat({ to, icon: Icon, label, value }: { to: string; icon: typeof Library; label: string; value: number | undefined }) {
  return (
    <Link to={to} className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
      <Card className="transition-colors hover:bg-accent">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="size-4" />
            {label}
          </span>
          {value === undefined ? (
            <Skeleton className="h-6 w-8" />
          ) : (
            <span className="font-mono text-xl font-semibold tabular-nums">{value}</span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

/** Invite codes: sign-up is invite-only. */
function Invites() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["invites"], queryFn: () => api.listInvites() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["invites"] });
  const create = useMutation({ mutationFn: () => api.createInvite(), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (code: string) => api.revokeInvite(code), onSuccess: refresh });

  const open = (data?.invites ?? []).filter((i) => !i.usedAt && !(i.expiresAt && new Date(i.expiresAt) < new Date()));
  const done = (data?.invites ?? []).filter((i) => !open.includes(i));

  return (
    <section aria-labelledby="invites-heading" className="space-y-2">
      <h2 id="invites-heading" className="label-mono">
        Invites
      </h2>
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Sonic is invite-only. Each code works once and expires after 14 days.
            </p>
            <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending || data?.remaining === 0}>
              <Plus className="size-4" />
              {create.isPending ? "Creating…" : "New invite"}
            </Button>
          </div>
          {data?.remaining === 0 && (
            <p className="text-xs text-muted-foreground">You have 5 unused invites — revoke one to make another.</p>
          )}
          {(create.isError || revoke.isError) && (
            <Alert variant="destructive">
              <AlertDescription>Couldn’t update your invites. Try again.</AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : open.length === 0 && done.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invites yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {open.map((i) => (
                <InviteRow key={i.code} invite={i} onRevoke={() => revoke.mutate(i.code)} revoking={revoke.isPending} />
              ))}
              {done.map((i) => (
                <li key={i.code} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-muted-foreground">
                  <span className="font-mono">{i.code}</span>
                  <span>{i.usedAt ? `Used by ${i.usedBy ?? "someone"} · ${date(i.usedAt)}` : "Expired"}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function InviteRow({ invite, onRevoke, revoking }: { invite: Invite; onRevoke: () => void; revoking: boolean }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const link = `${window.location.origin}/signup?invite=${encodeURIComponent(invite.code)}`;
  const copy = async (what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(what === "code" ? invite.code : link);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard blocked (e.g. not https): the code is visible to copy by hand.
    }
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Ticket className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm font-medium">{invite.code}</span>
        {invite.expiresAt && <Badge variant="secondary">expires {date(invite.expiresAt)}</Badge>}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => copy("code")} aria-label={`Copy invite code ${invite.code}`}>
          {copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />}
          Code
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy("link")} aria-label="Copy sign-up link">
          {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}
          Link
        </Button>
        <Button variant="ghost" size="icon" onClick={onRevoke} disabled={revoking} aria-label={`Revoke invite ${invite.code}`} title="Revoke">
          <X className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN;
  const sameAsCurrent = next.length > 0 && next === current;
  const mismatch = confirm.length > 0 && confirm !== next;
  const invalid = !current || next.length < PASSWORD_MIN || sameAsCurrent || confirm !== next;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setDone(false);
    setError(null);
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true, // sign out every other device
    });
    setPending(false);
    if (error) {
      setError(error.status === 400 || error.status === 401 ? "Current password is incorrect." : authErrorMessage(error, "Couldn’t change the password."));
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setDone(true);
  }

  return (
    <section aria-labelledby="password-heading" className="space-y-2">
      <h2 id="password-heading" className="label-mono">
        Password
      </h2>
      <Card>
        <CardContent className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            Changing it signs you out everywhere else — on your phone too — but keeps you signed in here.
          </p>
          {done && (
            <Alert>
              <Check className="size-4" />
              <AlertDescription>Password changed. Other devices will need to log in again.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form className="grid gap-4 sm:max-w-sm" onSubmit={submit}>
            <input type="text" name="username" autoComplete="username" hidden readOnly />
            <div className="grid gap-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <PasswordInput id="current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-password">New password</Label>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-invalid={tooShort || sameAsCurrent || undefined}
                aria-describedby="new-password-hint"
                required
              />
              <p id="new-password-hint" className={tooShort || sameAsCurrent ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {sameAsCurrent ? "Must be different from the current password." : `At least ${PASSWORD_MIN} characters.`}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={mismatch || undefined}
                required
              />
              {mismatch && <p className="text-xs text-destructive">Doesn’t match the new password.</p>}
            </div>
            <div>
              <Button type="submit" disabled={invalid || pending}>
                <KeyRound className="size-4" />
                {pending ? "Changing…" : "Change password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
