import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SonicApiError } from "@sonic/api-client";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  apiUrl,
  authClient,
  authErrorMessage,
  clearSessionCookie,
  onUnauthorized,
  PASSWORD_MIN,
  refreshSessionCookie,
} from "./api.js";
import { CaptureFlow } from "./capture/CaptureFlow.js";
import { CatalogScreen } from "./catalog/CatalogScreen.js";
import { retryNow, startUploadQueue, useUploadQueue } from "./offline/uploadQueue.js";
import { ThemeProvider, useTheme } from "./theme/ThemeProvider.js";
import { fonts, radius } from "./theme/tokens.js";
import {
  Button,
  Card,
  Field,
  Header,
  IconButton,
  LogoMark,
  RetroStripe,
  TabBar,
  type TabKey,
  Text,
  ThemeToggle,
} from "./ui/index.js";

/** A 401 from our API means the session has ended: re-check it (→ sign-in screen). */
function on401(e: unknown) {
  if (e instanceof SonicApiError && e.status === 401) onUnauthorized();
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: on401 }),
  mutationCache: new MutationCache({ onError: on401 }),
});

export function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <Root />
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { colors, scheme } = useTheme();
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id ?? null;
  // The user whose session cookie is loaded into memory (image headers, upload
  // queue). The signed-in shell waits for it so photos never load without it.
  const [cookieFor, setCookieFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const signingOut = useRef(false);
  const prevUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      clearSessionCookie();
      setCookieFor(null);
      return;
    }
    let cancelled = false;
    void refreshSessionCookie().then(() => {
      if (!cancelled) setCookieFor(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Whoever is signed in changed (including to nobody): nothing of the previous
  // user's may linger. Losing the session without signing out = it expired.
  useEffect(() => {
    if (isPending) return;
    const prev = prevUser.current;
    prevUser.current = userId;
    if (prev === undefined || prev === userId) return;
    queryClient.clear();
    if (prev && !userId && !signingOut.current) setNotice("Your session has expired — sign in again.");
    if (userId) setNotice(null);
    signingOut.current = false;
  }, [userId, isPending]);

  const onLogout = async () => {
    signingOut.current = true;
    setNotice(null);
    // The Expo plugin drops the stored cookie + cached session even if the request fails.
    await authClient.signOut().catch(() => {});
    clearSessionCookie();
    queryClient.clear();
  };

  const username = session ? displayName(session.user) : "";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {isPending ? null : session ? (
        cookieFor === userId ? <MainShell username={username} onLogout={onLogout} /> : null
      ) : (
        <AuthScreen notice={notice} />
      )}
    </View>
  );
}

function displayName(user: { name: string; username?: string | null; displayUsername?: string | null }): string {
  return user.displayUsername || user.username || user.name;
}

/**
 * Signed-in shell: header (theme toggle, log out), Capture / Catalog tabs.
 * Starts the offline upload queue, which also resumes anything left from
 * before a restart or logout.
 */
function MainShell({ username, onLogout }: { username: string; onLogout: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>("capture");
  const { pending } = useUploadQueue();
  const waiting = pending.filter((p) => p.status !== "failed").length;

  useEffect(() => {
    void startUploadQueue().then(() => retryNow());
  }, []);

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <Header
        right={
          <>
            {username ? (
              <Text
                variant="label"
                numberOfLines={1}
                accessibilityLabel={`Signed in as ${username}`}
                style={{ maxWidth: 120, marginRight: 4, textTransform: "none", color: colors.mutedForeground }}
              >
                {username}
              </Text>
            ) : null}
            <ThemeToggle />
            <IconButton icon="log-out" label={username ? `Log out ${username}` : "Log out"} onPress={onLogout} />
          </>
        }
      />
      <View style={{ flex: 1 }}>
        {tab === "capture" ? <CaptureFlow bottomPadding={24} /> : <CatalogScreen bottomPadding={24} />}
      </View>
      <TabBar
        active={tab}
        onChange={setTab}
        bottomInset={insets.bottom}
        badges={{ capture: waiting || undefined }}
      />
    </View>
  );
}

type AuthMode = "signin" | "signup";

/**
 * Signed out: sign in, or create an account with an invite code. Mirrors the
 * web auth card: stripe-topped card with logo, wordmark, mono labels, and a
 * Sign in / Create account switch.
 */
function AuthScreen({ notice }: { notice: string | null }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [mode, setMode] = useState<AuthMode>("signin");

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ position: "absolute", top: insets.top + 8, right: 12, zIndex: 1 }}>
        <ThemeToggle />
      </View>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 16,
          paddingTop: insets.top + 56,
          paddingBottom: insets.bottom + 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <RetroStripe height={16} />
          <View style={{ padding: 24, gap: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <LogoMark size={36} />
              <Text variant="label">Vinyl catalog</Text>
            </View>
            <View style={{ gap: 4 }}>
              <Text variant="title">Sonic</Text>
              <Text variant="muted">
                {mode === "signin" ? "Sign in to your collection" : "Create your account — you'll need an invite code"}
              </Text>
            </View>
            <ModeSwitch mode={mode} onChange={setMode} />
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
          <View style={{ padding: 24, gap: 16 }}>
            {notice && mode === "signin" ? (
              <Text variant="muted" accessibilityRole="alert">
                {notice}
              </Text>
            ) : null}
            {mode === "signin" ? <SignInForm /> : <SignUpForm />}
          </View>
        </Card>
        <Text variant="label" style={{ textAlign: "center", marginTop: 16, textTransform: "none" }}>
          API · {apiUrl}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Sign in / Create account tabs (44pt targets, like the web's tablist). */
function ModeSwitch({ mode, onChange }: { mode: AuthMode; onChange: (m: AuthMode) => void }) {
  const { colors } = useTheme();
  const options: [AuthMode, string][] = [
    ["signin", "Sign in"],
    ["signup", "Create account"],
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        gap: 4,
        padding: 3,
        borderRadius: radius.md,
        backgroundColor: colors.muted,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      {options.map(([m, label]) => {
        const active = m === mode;
        return (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(m)}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              backgroundColor: active ? colors.card : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: active ? fonts.sansMedium : fonts.sans,
                fontSize: 14,
                color: active ? colors.foreground : colors.mutedForeground,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const NETWORK_ERROR = "Couldn't reach the server";

function SignInForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!username.trim() || !password || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error } = await authClient.signIn.username({ username: username.trim(), password });
      if (error) {
        setError(error.status === 401 ? "Invalid username or password" : authErrorMessage(error, "Sign-in failed — try again"));
        return;
      }
      // Nothing of a previous user's may show for this one.
      queryClient.clear();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Field
        label="Username"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        value={username}
        onChangeText={setUsername}
      />
      <Field
        label="Password"
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error && (
        <Text variant="error" accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Button
        title={busy ? "Signing in…" : "Log in"}
        onPress={submit}
        loading={busy}
        disabled={!username.trim() || !password}
        style={{ marginTop: 4 }}
      />
    </>
  );
}

function SignUpForm() {
  const [form, setForm] = useState({ inviteCode: "", username: "", email: "", password: "", confirm: "" });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const username = form.username.trim();
  const usernameBad = username.length > 0 && !/^[A-Za-z0-9_.]{3,30}$/.test(username);
  const tooShort = form.password.length > 0 && form.password.length < PASSWORD_MIN;
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const invalid =
    !form.inviteCode.trim() ||
    !username ||
    usernameBad ||
    !form.email.trim() ||
    form.password.length < PASSWORD_MIN ||
    form.confirm !== form.password;

  async function submit() {
    if (invalid || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error } = await authClient.signUp.email({
        email: form.email.trim(),
        password: form.password,
        name: username,
        username,
        // Checked (and used up) by the server; not stored on the account.
        inviteCode: form.inviteCode.trim(),
      } as Parameters<typeof authClient.signUp.email>[0]);
      if (error) {
        setError(authErrorMessage(error, "Couldn't create the account — try again"));
        return;
      }
      queryClient.clear();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Field
        label="Invite code"
        placeholder="SONIC-XXXX-XXXX"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        value={form.inviteCode}
        onChangeText={set("inviteCode")}
        style={{ fontFamily: fonts.mono }}
      />
      <View style={{ gap: 6 }}>
        <Field
          label="Username"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="username"
          value={form.username}
          onChangeText={set("username")}
          accessibilityHint={usernameBad ? "3 to 30 letters, numbers, underscores or dots" : undefined}
        />
        {usernameBad && <Hint bad>3–30 letters, numbers, _ or .</Hint>}
      </View>
      <Field
        label="Email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        value={form.email}
        onChangeText={set("email")}
      />
      <View style={{ gap: 6 }}>
        <Field
          label="Password"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          value={form.password}
          onChangeText={set("password")}
          accessibilityHint={`At least ${PASSWORD_MIN} characters`}
        />
        <Hint bad={tooShort}>At least {PASSWORD_MIN} characters.</Hint>
      </View>
      <View style={{ gap: 6 }}>
        <Field
          label="Confirm password"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          value={form.confirm}
          onChangeText={set("confirm")}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        {mismatch && <Hint bad>Doesn't match.</Hint>}
      </View>
      {error && (
        <Text variant="error" accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Button
        title={busy ? "Creating account…" : "Create account"}
        onPress={submit}
        loading={busy}
        disabled={invalid}
        style={{ marginTop: 4 }}
      />
    </>
  );
}

function Hint({ bad, children }: { bad?: boolean; children: React.ReactNode }) {
  return (
    <Text variant={bad ? "error" : "muted"} style={{ fontSize: 12, lineHeight: 16 }}>
      {children}
    </Text>
  );
}
