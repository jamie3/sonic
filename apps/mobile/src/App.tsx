import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { api, loadToken, saveToken } from "./api.js";

const queryClient = new QueryClient();

export function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    loadToken().then((t) => {
      setAuthed(!!t);
      setReady(true);
    });
  }, []);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
        <StatusBar style="auto" />
        {authed ? <CaptureHome /> : <Login onLogin={() => setAuthed(true)} />}
      </View>
    </QueryClientProvider>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    const res = await api.login({ username, password });
    await saveToken(res.token);
    onLogin();
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 28, fontWeight: "600" }}>Sonic</Text>
      <TextInput placeholder="username" autoCapitalize="none" value={username} onChangeText={setUsername} />
      <TextInput placeholder="password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button title="Log in" onPress={submit} />
    </View>
  );
}

function CaptureHome() {
  // TODO: expo-camera capture flow (front/back/labels + on-device barcode scan),
  // then api.createCapture(photos, barcodeHint). This is the mobile app's primary job.
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Add a record</Text>
      <Text>Camera capture flow goes here (expo-camera).</Text>
    </View>
  );
}
