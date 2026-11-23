import { Feather } from "@expo/vector-icons";
import type { TrashItem, TrashKind } from "@sonic/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, imageSource } from "../api.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { fonts, radius } from "../theme/tokens.js";
import { IconButton, RetroStripe, Text } from "../ui/index.js";

const DAY_MS = 86_400_000;
const daysLeft = (i: TrashItem) => Math.max(0, Math.ceil((Date.parse(i.purgeAt) - Date.now()) / DAY_MS));

/** Everything that shows catalog contents must refresh after a trash action. */
export function useRefreshAfterTrash() {
  const qc = useQueryClient();
  return () => {
    for (const key of [["trash"], ["catalog"], ["captures"], ["tags"], ["catalog-entry"], ["capture"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

/** Trash bin: restore, delete forever, or empty. Items auto-delete after the retention period. */
export function TrashScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const refresh = useRefreshAfterTrash();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["trash"],
    queryFn: () => api.listTrash(),
  });

  const restore = useMutation({
    mutationFn: (i: { kind: TrashKind; id: string }) => api.restoreFromTrash(i.kind, i.id),
    onSuccess: refresh,
  });
  const forever = useMutation({
    mutationFn: (i: { kind: TrashKind; id: string }) => api.deleteForever(i.kind, i.id),
    onSuccess: refresh,
  });
  const empty = useMutation({ mutationFn: () => api.emptyTrash(), onSuccess: refresh });
  const failed = restore.isError || forever.isError || empty.isError;

  const items = data?.items ?? [];

  const confirmForever = (i: TrashItem) =>
    Alert.alert("Delete forever?", `“${i.title}” and its photos will be permanently deleted. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete forever", style: "destructive", onPress: () => forever.mutate(i) },
    ]);
  const confirmEmpty = () =>
    Alert.alert(
      "Empty the trash?",
      `All ${items.length} item${items.length === 1 ? "" : "s"} and their photos will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Empty trash", style: "destructive", onPress: () => empty.mutate() },
      ],
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RetroStripe height={6} />
      <View style={[styles.bar, { borderBottomColor: colors.border }]}>
        <Text variant="label">Trash</Text>
        <IconButton icon="x" label="Close" onPress={onClose} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => `${i.kind}:${i.id}`}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 32 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            <Text variant="muted">
              Items are permanently deleted {data?.retentionDays ?? 30} days after being moved here.
            </Text>
            {failed && <Text variant="error">Something went wrong. Pull to refresh and try again.</Text>}
            {items.length > 0 && (
              <Pressable
                onPress={confirmEmpty}
                disabled={empty.isPending}
                accessibilityRole="button"
                style={({ pressed }) => [styles.emptyBtn, { borderColor: colors.input, opacity: pressed ? 0.6 : 1 }]}
              >
                <Feather name="trash-2" size={14} color={colors.destructive} />
                <Text variant="label" style={{ color: colors.destructive }}>
                  {empty.isPending ? "Emptying…" : `Empty trash (${items.length})`}
                </Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
          ) : isError ? (
            <Text variant="error">Couldn't load the trash.</Text>
          ) : (
            <View style={[styles.empty, { borderColor: colors.input }]}>
              <Feather name="trash-2" size={24} color={colors.mutedForeground} />
              <Text style={{ fontFamily: fonts.sansMedium }}>Trash is empty</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const left = daysLeft(item);
          const busy =
            (restore.isPending && restore.variables?.id === item.id) ||
            (forever.isPending && forever.variables?.id === item.id);
          return (
            <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.thumb, { backgroundColor: colors.muted }]}>
                {item.imageUrl ? (
                  <Image source={imageSource(item.imageUrl)} style={[StyleSheet.absoluteFill, { opacity: 0.8 }]} />
                ) : (
                  <Feather name="disc" size={20} color={colors.mutedForeground} />
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.sansMedium }}>
                  {item.title}
                </Text>
                <Text variant="muted" numberOfLines={1} style={{ fontSize: 13 }}>
                  {item.subtitle}
                </Text>
                <Text variant="label" style={{ marginTop: 2 }}>
                  {left === 0 ? "Deleted at next cleanup" : `Deleted forever in ${left}d`}
                </Text>
                <View style={styles.actions}>
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Pressable onPress={() => restore.mutate(item)} hitSlop={8} accessibilityRole="button">
                        <Text variant="label" style={{ color: colors.primary }}>
                          Restore
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => confirmForever(item)} hitSlop={8} accessibilityRole="button">
                        <Text variant="label" style={{ color: colors.destructive }}>
                          Delete forever
                        </Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />
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
  row: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", gap: 20, marginTop: 6, minHeight: 18 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 48,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.lg,
  },
});
