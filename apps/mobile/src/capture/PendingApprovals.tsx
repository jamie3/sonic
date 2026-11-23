import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { api, imageSource } from "../api.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { radius } from "../theme/tokens.js";
import { Card, StatusPill, Text } from "../ui/index.js";
import { apiErrorMessage, captureTitle, isAwaitingApproval, useRefreshAfterApprove } from "./ApproveSection.js";
import { CaptureDetail, type CaptureRef, SERVER_STATUS } from "./CaptureDetail.js";
import { Row } from "./RecentCaptures.js";

/**
 * "Ready to approve" on the Capture tab: every capture on the server awaiting
 * a decision (from any device), plus any still being checked on Discogs. Tap
 * one to approve it in the capture sheet; confident single matches can be
 * approved together. Hidden when there's nothing to review.
 */
export function PendingApprovals() {
  const { colors } = useTheme();
  const refresh = useRefreshAfterApprove();
  const [open, setOpen] = useState<CaptureRef | null>(null);
  const { data } = useQuery({
    queryKey: ["captures", "pending"],
    queryFn: () => api.listPending(), // review + pending_*
    // Poll while anything is still being matched (e.g. after a re-scan).
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === "review") ? 4000 : false),
  });

  const bulk = useMutation({
    mutationFn: (ids: string[]) => api.approveBulk({ captureIds: ids }),
    onSettled: refresh,
    onSuccess: (r) => {
      if (r.skipped.length > 0) {
        Alert.alert(
          `Approved ${r.approved.length}, skipped ${r.skipped.length}`,
          r.skipped.map((s) => s.reason).join("\n"),
        );
      }
    },
  });

  const list = data ?? [];
  const ready = list.filter((c) => isAwaitingApproval(c.status));
  const checking = list.filter((c) => c.status === "review");
  if (ready.length === 0 && checking.length === 0) return null;
  const singleIds = ready.filter((c) => c.status === "pending_single").map((c) => c.id);

  const confirmBulk = () =>
    Alert.alert(
      `Approve ${singleIds.length} confident match${singleIds.length === 1 ? "" : "es"}?`,
      "Each is added to your catalog with its top Discogs match.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve", onPress: () => bulk.mutate(singleIds) },
      ],
    );

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text variant="label" accessibilityRole="header">
          Ready to approve ({ready.length})
        </Text>
        {singleIds.length > 0 && (
          <Pressable
            onPress={confirmBulk}
            disabled={bulk.isPending}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Approve all ${singleIds.length} confident matches`}
            accessibilityState={{ disabled: bulk.isPending, busy: bulk.isPending }}
            style={({ pressed }) => ({ minHeight: 32, justifyContent: "center", opacity: pressed || bulk.isPending ? 0.5 : 1 })}
          >
            <Text variant="label" style={{ color: colors.primary }}>
              {bulk.isPending ? "Approving…" : `Approve all matched (${singleIds.length})`}
            </Text>
          </Pressable>
        )}
      </View>
      {bulk.isError && <Text variant="error">{apiErrorMessage(bulk.error, "approve those captures")}</Text>}

      <Card>
        {[...ready, ...checking].map((c, i) => {
          const front = c.photos.find((p) => p.type === "front") ?? c.photos[0];
          const s = SERVER_STATUS[c.status];
          return (
            <Row
              key={c.id}
              first={i === 0}
              onPress={() => setOpen({ kind: "uploaded", id: c.id })}
              accessibilityLabel={`${captureTitle(c)}, ${s.text}. Open to review`}
              thumb={
                front ? (
                  <Image source={imageSource(front.url)} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: colors.muted }]} />
                )
              }
            >
              <Text style={styles.title} numberOfLines={1}>
                {captureTitle(c)}
              </Text>
              <StatusPill label={s.text} color={s.color} />
            </Row>
          );
        })}
      </Card>

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

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 8 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
  title: { fontSize: 15 },
});
