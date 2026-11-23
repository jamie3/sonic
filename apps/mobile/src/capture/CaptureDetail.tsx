import type { CaptureExtraction, CapturePhoto, CaptureStatus, PhotoType } from "@sonic/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  type ImageSourcePropType,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, imageSource } from "../api.js";
import { ApproveSection, apiErrorMessage, captureTitle, isAwaitingApproval } from "./ApproveSection.js";
import { useRefreshAfterTrash } from "../catalog/TrashScreen.js";
import {
  discardCapture,
  forgetUploaded,
  photoUri,
  type QueuedCapture,
  retryNow,
  useUploadQueue,
} from "../offline/uploadQueue.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { palette, radius } from "../theme/tokens.js";
import { Button, Card, DetailRow, IconButton, RetroStripe, StatusPill, Text } from "../ui/index.js";

export type CaptureRef = { kind: "queued"; id: string } | { kind: "uploaded"; id: string };

const PHOTO_LABEL: Record<PhotoType, string> = {
  front: "Front",
  back: "Back",
  label_a: "Label A",
  label_b: "Label B",
  spine: "Spine",
};

export const SERVER_STATUS: Record<CaptureStatus, { text: string; color: string }> = {
  // On the server; the extractor hasn't read the photos yet.
  processing: { text: "Uploaded — reading photos…", color: palette.mustardYellow },
  // The extractor has read the text; the worker is checking Discogs.
  review: { text: "Text read — checking Discogs…", color: palette.tealBlue },
  pending_single: { text: "Matched — ready to approve", color: palette.avocadoGreen },
  pending_multiple: { text: "Several matches — pick one", color: palette.tealBlue },
  pending_nomatch: { text: "No Discogs match — ready to approve", color: palette.rustRed },
  approved: { text: "Approved", color: palette.avocadoGreen },
  skipped: { text: "Skipped", color: palette.chocolateBrown },
};

export const QUEUED_STATUS: Record<QueuedCapture["status"], { text: string; color: string }> = {
  waiting: { text: "Saved on phone — waiting to upload", color: palette.harvestGold },
  uploading: { text: "Uploading…", color: palette.harvestOrange },
  paused: { text: "Paused — log in to resume", color: palette.chocolateBrown },
  failed: { text: "Upload rejected", color: palette.rustRed },
};

const time = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;

/**
 * Sheet for one recent capture: its photos (tap to enlarge) and status. A
 * capture still on the phone shows its local photos with Retry / Delete; an
 * uploaded one shows the server's copies and, once matched, lets the owner
 * approve it (Discogs match or what was read) — see ApproveSection.
 */
export function CaptureDetail({ target, onClose }: { target: CaptureRef; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [viewing, setViewing] = useState<{ source: ImageSourcePropType; label: string } | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RetroStripe height={6} />
      <View style={[styles.bar, { borderBottomColor: colors.border }]}>
        <Text variant="label">Capture</Text>
        <IconButton icon="x" label="Close" onPress={onClose} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // Keeps the "use what was read" form's inputs above the keyboard (iOS).
        automaticallyAdjustKeyboardInsets
      >
        {target.kind === "queued" ? (
          <QueuedBody id={target.id} onView={setViewing} onGone={onClose} />
        ) : (
          <UploadedBody id={target.id} onView={setViewing} onGone={onClose} />
        )}
      </ScrollView>

      {/* Full-screen photo viewer */}
      <Modal visible={viewing !== null} animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {viewing && <Image source={viewing.source} style={{ flex: 1 }} resizeMode="contain" />}
          <View style={[styles.viewerBar, { top: insets.top + 8 }]}>
            <Text variant="label" style={{ color: "#f3eee3" }}>
              {viewing?.label}
            </Text>
            <Pressable
              onPress={() => setViewing(null)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
            >
              <Text style={{ color: "#f3eee3", fontSize: 16 }}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

type OnView = (v: { source: ImageSourcePropType; label: string }) => void;

function PhotoGrid({ photos, onView }: { photos: { key: string; source: ImageSourcePropType; label: string }[]; onView: OnView }) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {photos.map((p) => (
        <Pressable
          key={p.key}
          style={styles.tile}
          onPress={() => onView({ source: p.source, label: p.label })}
          accessibilityRole="imagebutton"
          accessibilityLabel={`View ${p.label} photo`}
        >
          <Image source={p.source} style={[styles.tileImg, { borderColor: colors.border }]} resizeMode="cover" />
          <Text variant="label">{p.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function QueuedBody({ id, onView, onGone }: { id: string; onView: OnView; onGone: () => void }) {
  const { colors } = useTheme();
  const { pending, uploaded } = useUploadQueue();
  const item = pending.find((p) => p.id === id);

  if (!item) {
    // It finished uploading (or was deleted) while the sheet was open.
    return uploaded.includes(id) ? (
      <UploadedBody id={id} onView={onView} onGone={onGone} />
    ) : (
      <Text variant="muted">This capture is no longer on the phone.</Text>
    );
  }

  const s = QUEUED_STATUS[item.status];
  return (
    <>
      <View style={{ gap: 8 }}>
        <Text variant="heading">
          {item.media === "vinyl" ? "Vinyl" : "CD"} · {item.photos.length} photo{item.photos.length === 1 ? "" : "s"}
        </Text>
        <StatusPill label={s.text} color={s.color} />
        {item.lastError && item.status !== "uploading" ? <Text variant="error">{item.lastError}</Text> : null}
      </View>

      <PhotoGrid
        onView={onView}
        photos={item.photos.map((p) => ({
          key: p.file,
          source: { uri: photoUri(item, p.file) },
          label: PHOTO_LABEL[p.type],
        }))}
      />

      <Card style={{ paddingHorizontal: 12 }}>
        <DetailRow label="Saved" value={time(item.createdAt)} />
        <DetailRow label="Attempts" value={String(item.attempts)} mono />
        <DetailRow label="Last try" value={time(item.lastAttemptAt)} />
        <DetailRow label="Barcode" value={item.barcode} mono />
      </Card>

      <Button
        title={item.status === "uploading" ? "Uploading…" : "Retry upload"}
        onPress={() => void retryNow(item.id)}
        loading={item.status === "uploading"}
      />
      <Button
        title="Delete from phone"
        variant="ghost"
        onPress={() =>
          Alert.alert("Delete this capture?", "Its photos will be removed from the phone. This can't be undone.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => {
                discardCapture(item.id);
                onGone();
              },
            },
          ])
        }
      />
      <Text variant="muted" style={{ fontSize: 12, textAlign: "center", color: colors.mutedForeground }}>
        Uploads also retry automatically when you're back online.
      </Text>
    </>
  );
}

function UploadedBody({ id, onView, onGone }: { id: string; onView: OnView; onGone: () => void }) {
  const { colors } = useTheme();
  const refresh = useRefreshAfterTrash();
  // Set once approved here: "Artist — Title" of the new catalog entry.
  const [approved, setApproved] = useState<string | null>(null);
  const trash = useMutation({
    mutationFn: () => api.trashCapture(id),
    onSuccess: async () => {
      await forgetUploaded(id);
      refresh();
      onGone();
    },
  });
  const { data: c, isLoading, isError, refetch } = useQuery({
    queryKey: ["capture", id],
    queryFn: () => api.getCapture(id),
    // Poll while the extractor or matcher is working (incl. after a re-scan).
    refetchInterval: (q) =>
      q.state.data?.status === "processing" || q.state.data?.status === "review" ? 3000 : false,
  });

  if (isLoading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />;
  if (isError || !c) {
    return (
      <View style={{ gap: 12 }}>
        <Text variant="error">Couldn't load this capture from the server.</Text>
        <Button title="Try again" variant="outline" onPress={() => void refetch()} />
      </View>
    );
  }

  const s = SERVER_STATUS[c.status];
  // Hide the approve controls as soon as it's approved, before the refetch lands.
  const awaiting = isAwaitingApproval(c.status) && approved === null;
  return (
    <>
      {approved !== null && (
        <Card style={{ padding: 12, gap: 10, borderColor: palette.avocadoGreen, borderWidth: 1 }}>
          <View accessible accessibilityRole="alert" style={{ gap: 2 }}>
            <Text variant="label" style={{ color: palette.avocadoGreen }}>
              Added to catalog
            </Text>
            <Text>{approved}</Text>
          </View>
          <Button title="Done" onPress={onGone} />
        </Card>
      )}
      <View style={{ gap: 8 }}>
        <Text variant="heading">{captureTitle(c)}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusPill label={s.text} color={s.color} />
          {c.status === "processing" || c.status === "review" ? (
            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Working" />
          ) : null}
        </View>
        {/* ApproveSection shows the match message itself. */}
        {!awaiting && c.match?.message ? (
          <Text variant={c.match.outcome === "error" ? "error" : "muted"} style={{ fontSize: 13 }}>
            {c.match.message}
          </Text>
        ) : null}
      </View>

      <PhotoGrid
        onView={onView}
        photos={c.photos.map((p: CapturePhoto) => ({
          key: p.id,
          source: imageSource(p.url),
          label: PHOTO_LABEL[p.type],
        }))}
      />

      <Card style={{ paddingHorizontal: 12 }}>
        <DetailRow label="Uploaded" value={time(c.createdAt)} />
        <DetailRow label="Barcode" value={c.barcodeHint} mono />
      </Card>

      {awaiting && (
        <ApproveSection
          key={c.id}
          capture={c}
          onApproved={(entry) => setApproved(`${entry.release.artist} — ${entry.release.title}`)}
        />
      )}

      {c.extraction && (
        <ExtractionSection
          captureId={c.id}
          extraction={c.extraction}
          // The server refuses to re-read once a capture is approved or skipped.
          canReadAgain={c.status !== "approved" && c.status !== "skipped"}
        />
      )}

      {!awaiting && c.candidates.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text variant="label">Discogs matches</Text>
          <Card>
            {c.candidates.slice(0, 5).map((cand, i) => (
              <View
                key={cand.id}
                style={[
                  { padding: 12, gap: 2 },
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <Text numberOfLines={1}>
                  {cand.release.artist} — {cand.release.title}
                </Text>
                <Text variant="muted" style={{ fontSize: 12 }} numberOfLines={1}>
                  {[
                    cand.score != null ? `${Math.round(cand.score * 100)}% match` : null,
                    cand.release.year,
                    cand.release.label,
                    cand.release.catalogNumber,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            ))}
          </Card>
        </View>
      )}

      {c.status !== "approved" && approved === null && (
        <>
          {trash.isError && <Text variant="error">Couldn't move it to the trash. Try again.</Text>}
          <Button
            title="Move to trash"
            variant="outline"
            loading={trash.isPending}
            onPress={() =>
              Alert.alert(
                "Move to trash?",
                "This upload and its photos will move to the trash. You can restore it for 30 days.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Move to trash", style: "destructive", onPress: () => trash.mutate() },
                ],
              )
            }
          />
        </>
      )}
    </>
  );
}

/** What the extractor read off the photos (fields + the full transcription). */
function ExtractionSection({
  captureId,
  extraction: x,
  canReadAgain,
}: {
  captureId: string;
  extraction: CaptureExtraction;
  canReadAgain: boolean;
}) {
  const { colors } = useTheme();
  const [showText, setShowText] = useState(false);
  const refresh = useRefreshAfterTrash(); // refreshes capture queries too
  const readAgain = useMutation({ mutationFn: () => api.readAgain(captureId), onSuccess: refresh, onError: refresh });
  const readAgainButton = canReadAgain ? (
    <View style={{ gap: 6 }}>
      <Button
        title={readAgain.isPending ? "Sending…" : "Read photos again"}
        variant="outline"
        loading={readAgain.isPending}
        onPress={() => readAgain.mutate()}
      />
      {readAgain.isError && <Text variant="error">{apiErrorMessage(readAgain.error, "send it back to be read")}</Text>}
    </View>
  ) : null;
  if (x.error) {
    return (
      <View style={{ gap: 8 }}>
        <Text variant="label">Text from photos</Text>
        <Text variant="error">Couldn't read these photos: {x.error}</Text>
        {readAgainButton}
      </View>
    );
  }
  const f = x.fields;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">Text from photos</Text>
      <Card style={{ paddingHorizontal: 12 }}>
        <DetailRow label="Artist" value={f.artist} />
        <DetailRow label="Title" value={f.title} />
        <DetailRow label="Label" value={f.label} />
        <DetailRow label="Catalog no." value={f.catalogNumber} mono />
        <DetailRow label="Barcode" value={f.barcode} mono />
        <DetailRow label="Year" value={f.year?.toString()} />
        <DetailRow label="Country" value={f.country} />
        <DetailRow label="Format" value={f.format} />
        {f.tracklist.length > 0 && (
          <View style={{ paddingVertical: 10, gap: 4 }}>
            <Text variant="label">Tracklist</Text>
            {f.tracklist.map((t, i) => (
              <Text key={i} style={{ fontSize: 14 }}>
                <Text variant="mono" style={{ color: colors.mutedForeground }}>
                  {t.position ? `${t.position}  ` : ""}
                </Text>
                {t.title}
              </Text>
            ))}
          </View>
        )}
      </Card>
      {x.rawText ? (
        <>
          <Pressable onPress={() => setShowText((v) => !v)} hitSlop={8} accessibilityRole="button">
            <Text variant="label" style={{ color: colors.primary }}>
              {showText ? "Hide" : "Show"} all text read
            </Text>
          </Pressable>
          {showText && (
            <Card style={{ padding: 12 }}>
              <Text variant="mono" style={{ fontSize: 12, lineHeight: 18 }}>
                {x.rawText}
              </Text>
            </Card>
          )}
        </>
      ) : null}
      <Text variant="muted" style={{ fontSize: 12 }}>
        Read by {x.engine}
        {x.model ? ` (${x.model})` : ""}.
      </Text>
      {readAgainButton}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "47%", gap: 6 },
  tileImg: { width: "100%", aspectRatio: 1, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  viewerBar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
