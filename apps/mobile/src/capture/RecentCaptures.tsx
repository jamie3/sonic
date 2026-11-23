import type { Capture } from "@sonic/shared";
import { Feather } from "@expo/vector-icons";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { api, imageSource } from "../api.js";
import { photoUri, retryNow, useUploadQueue } from "../offline/uploadQueue.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { radius } from "../theme/tokens.js";
import { Card, StatusPill, Text } from "../ui/index.js";
import { captureTitle } from "./ApproveSection.js";
import { CaptureDetail, type CaptureRef, QUEUED_STATUS, SERVER_STATUS } from "./CaptureDetail.js";

/**
 * Captures still on the phone (upload queue) followed by recently uploaded
 * ones, which poll while the worker is processing. Tap a row for its photos.
 * Survives app restarts.
 */
export function RecentCaptures() {
  const { colors } = useTheme();
  const { pending, uploaded } = useUploadQueue();
  const [open, setOpen] = useState<CaptureRef | null>(null);

  const captures = useQueries({
    queries: uploaded.map((id) => ({
      queryKey: ["capture", id],
      queryFn: () => api.getCapture(id),
      refetchInterval: (q: { state: { data?: Capture } }) =>
        q.state.data?.status === "processing" || q.state.data?.status === "review" ? 3000 : false,
    })),
  });

  if (pending.length === 0 && uploaded.length === 0) return null;
  const queuedNewestFirst = [...pending].reverse();
  const retryable = pending.filter((p) => p.status !== "uploading");

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text variant="label">Recent captures</Text>
        {retryable.length > 0 && (
          <Pressable
            onPress={() => void retryNow()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Retry all ${retryable.length} uploads`}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Text variant="label" style={{ color: colors.primary }}>
              Retry all ({retryable.length})
            </Text>
          </Pressable>
        )}
      </View>

      <Card>
        {queuedNewestFirst.map((item, i) => {
          const s = QUEUED_STATUS[item.status];
          return (
            <Row
              key={item.id}
              first={i === 0}
              onPress={() => setOpen({ kind: "queued", id: item.id })}
              accessibilityLabel="Open capture saved on phone"
              thumb={<Image source={{ uri: photoUri(item, item.photos[0]!.file) }} style={styles.thumb} />}
            >
              <Text style={styles.title} numberOfLines={1}>
                {item.media === "vinyl" ? "Vinyl" : "CD"} · {item.photos.length} photo
                {item.photos.length === 1 ? "" : "s"}
              </Text>
              <StatusPill label={s.text} color={s.color} />
              {item.lastError && item.status !== "uploading" ? (
                <Text variant="muted" style={{ fontSize: 12 }} numberOfLines={2}>
                  {item.lastError}
                </Text>
              ) : null}
              {item.status === "uploading" ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: "flex-start" }} />
              ) : (
                <Pressable
                  onPress={() => void retryNow(item.id)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Retry this upload"
                  style={({ pressed }) => [styles.retry, { borderColor: colors.input, opacity: pressed ? 0.5 : 1 }]}
                >
                  <Feather name="refresh-cw" size={12} color={colors.foreground} />
                  <Text variant="label" style={{ color: colors.foreground }}>
                    Retry
                  </Text>
                </Pressable>
              )}
            </Row>
          );
        })}

        {captures.map((q, i) => {
          const c = q.data;
          const front = c?.photos.find((p) => p.type === "front") ?? c?.photos[0];
          return (
            <Row
              key={uploaded[i]}
              first={i === 0 && pending.length === 0}
              onPress={() => setOpen({ kind: "uploaded", id: uploaded[i]! })}
              accessibilityLabel="Open uploaded capture"
              thumb={
                front ? (
                  <Image source={imageSource(front.url)} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: colors.muted }]} />
                )
              }
            >
              <Text style={styles.title} numberOfLines={1}>
                {c ? captureTitle(c) : "Loading…"}
              </Text>
              {q.isError ? (
                <StatusPill label="Couldn't load status" color={colors.destructive} />
              ) : c ? (
                <StatusPill label={SERVER_STATUS[c.status].text} color={SERVER_STATUS[c.status].color} />
              ) : null}
            </Row>
          );
        })}
      </Card>
      <Text variant="muted" style={{ fontSize: 12 }}>
        Tap a capture to see its photos and approve it once it's matched.
      </Text>

      <Modal
        visible={open !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(null)}
      >
        {open && <CaptureDetail target={open} onClose={() => setOpen(null)} />}
      </Modal>
    </View>
  );
}

export function Row({
  first,
  thumb,
  onPress,
  accessibilityLabel,
  children,
}: {
  first: boolean;
  thumb: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
        pressed && { backgroundColor: colors.accent },
      ]}
    >
      {thumb}
      <View style={styles.rowBody}>{children}</View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} style={{ alignSelf: "center" }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 8 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  row: { padding: 12, gap: 12, flexDirection: "row", alignItems: "flex-start" },
  rowBody: { flex: 1, gap: 6 },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
  title: { fontSize: 15 },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: radius.md,
  },
});
