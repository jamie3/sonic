import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, getToken, setToken } from "./api.js";

export function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  return loggedIn ? (
    <Catalog onLogout={() => { setToken(null); setLoggedIn(false); }} />
  ) : (
    <Login onLogin={() => setLoggedIn(true)} />
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.login({ username, password });
      setToken(res.token);
      onLogin();
    } catch {
      setError("Invalid credentials");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: "10vh auto", display: "grid", gap: 8 }}>
      <h1>Sonic</h1>
      <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Log in</button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}

function Catalog({ onLogout }: { onLogout: () => void }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["catalog", q],
    queryFn: () => api.searchCatalog({ q: q || undefined, page: 1, pageSize: 40 }),
  });

  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>Catalog</h1>
        <button onClick={onLogout}>Log out</button>
      </header>
      <input placeholder="Search artist or title…" value={q} onChange={(e) => setQ(e.target.value)} />
      {isLoading && <p>Loading…</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 16, marginTop: 16 }}>
        {data?.items.map((entry) => (
          <article key={entry.id}>
            {entry.release.coverUrl && <img src={entry.release.coverUrl} alt="" style={{ width: "100%" }} />}
            <strong>{entry.release.artist}</strong>
            <div>{entry.release.title}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
