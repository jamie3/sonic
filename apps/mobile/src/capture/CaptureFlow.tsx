import type { PhotoType } from "@sonic/shared";
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { enqueueCapture } from "../offline/uploadQueue.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { Button, Segmented, Text } from "../ui/index.js";
import { CameraScreen } from "./CameraScreen.js";
import { PendingApprovals } from "./PendingApprovals.js";
import { RecentCaptures } from "./RecentCaptures.js";
import { SHOTS, type MediaKind, type TakenPhoto } from "./shots.js";

type Stage = { kind: "home" } | { kind: "review" };

/**
 * Capture tab: choose vinyl/CD → guided camera (full-screen modal) → review →
 * save. "Upload" hands the photos to the offline queue and returns immediately:
 * they're stored on the phone and sent in the background, retrying until the
 * server has them. Progress shows in Recent captures.
 */
export function CaptureFlow({ bottomPadding }: { bottomPadding: number }) {
  const { colors } = useTheme();
  const [media, setMedia] = useState<MediaKind>("vinyl");
  const [stage, setStage] = useState<Stage>({ kind: "home" });
  const [camera, setCamera] = useState<{ open: boolean; retake?: PhotoType }>({ open: false });
  const [photos, setPhotos] = useState<TakenPhoto[]>([]);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const shots = SHOTS[media];
  const retakeShot = camera.retake && shots.find((s) => s.type === camera.retake);

  function reset() {
    setPhotos([]);
    setBarcode(null);
    setSaveError(null);
    setStage({ kind: "home" });
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await enqueueCapture({ media, barcode, photos });
      reset();
    } catch (e) {
      // Only local storage can fail here (e.g. phone full) — network never blocks.
      setSaveError(e instanceof Error ? e.message : "Couldn't save photos on this phone");
    } finally {
      setSaving(false);
    }
  }

  const cameraModal = (
    <Modal
      visible={camera.open}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => setCamera({ open: false })}
    >
      <CameraScreen
        shots={retakeShot ? [retakeShot] : shots}
        initial={photos}
        initialBarcode={barcode}
        onCancel={() => setCamera({ open: false })}
        onDone={(taken, code) => {
          setPhotos(taken);
          setBarcode(code);
          setCamera({ open: false });
          setStage({ kind: "review" });
        }}
      />
    </Modal>
  );

  if (stage.kind === "review") {
    return (
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: bottomPadding }]}>
        {cameraModal}
        <View style={{ gap: 4 }}>
          <Text variant="label">Step 2 · Review</Text>
          <Text variant="heading">Check your photos</Text>
          <Text variant="muted">
            {media === "vinyl" ? "Vinyl record" : "CD"} · {photos.length} photo{photos.length === 1 ? "" : "s"}
            {barcode ? ` · barcode ${barcode}` : " · no barcode detected"}
          </Text>
        </View>

        <View style={styles.grid}>
          {shots.map((s) => {
            const p = photos.find((x) => x.type === s.type);
            return (
              <Pressable
                key={s.type}
                style={styles.tile}
                onPress={() => setCamera({ open: true, retake: s.type })}
                disabled={saving}
                accessibilityLabel={p ? `Retake ${s.label}` : `Add ${s.label}`}
              >
                {p ? (
                  <Image source={{ uri: p.uri }} style={[styles.tileImg, { borderColor: colors.border }]} />
                ) : (
                  <View
                    style={[
                      styles.tileImg,
                      styles.tileEmpty,
                      { backgroundColor: colors.muted, borderColor: colors.input },
                    ]}
                  >
                    <Text variant="label">+ Add</Text>
                  </View>
                )}
                <Text variant="label" style={{ color: colors.foreground }}>
                  {s.label}
                  {p ? " · retake" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {saveError && <Text variant="error">{saveError}</Text>}

        <Button title="Upload" onPress={save} loading={saving} disabled={photos.length === 0} />
        <Text variant="muted" style={{ fontSize: 12, textAlign: "center" }}>
          Photos are kept on this phone until the server has them — no signal needed.
        </Text>
        <Button title="Discard" variant="ghost" onPress={reset} disabled={saving} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: bottomPadding }]}>
      {cameraModal}
      <View style={{ gap: 4 }}>
        <Text variant="label">Step 1 · Capture</Text>
        <Text variant="heading">Add a record</Text>
      </View>

      <Segmented
        value={media}
        onChange={setMedia}
        options={[
          { value: "vinyl", label: "Vinyl" },
          { value: "cd", label: "CD" },
        ]}
      />

      <Text variant="muted">
        You'll be guided through {shots.map((s) => s.label.toLowerCase()).join(", ")}. Only the front is required;
        a barcode is picked up automatically if it's in view.
      </Text>

      <Button title="Take photos" onPress={() => setCamera({ open: true })} />

      <PendingApprovals />
      <RecentCaptures />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 20, gap: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "47%", gap: 6 },
  tileImg: { width: "100%", aspectRatio: 1, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  tileEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed" },
});
