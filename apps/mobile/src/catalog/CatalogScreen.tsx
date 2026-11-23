import type { CatalogEntry } from "@sonic/shared";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { api, imageSource } from "../api.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { fonts, radius } from "../theme/tokens.js";
import { Chip, Text } from "../ui/index.js";
import type { Capture, TrashKind } from "@sonic/shared";
import { CaptureDetail, type CaptureRef } from "../capture/CaptureDetail.js";
import { palette } from "../theme/tokens.js";
import { coverOf } from "./cover.js";
import { RecordDetail } from "./RecordDetail.js";
import { TrashScreen, useRefreshAfterTrash } from "./TrashScreen.js";

const PAGE_SIZE = 30;

/** Debounce a fast-changing value (search box). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Catalog tab: search by artist/title, filter by tag, 2-column cover grid with
 * infinite scroll and pull-to-refresh. Tapping a record opens its detail sheet.
 */
export function CatalogScreen({ bottomPadding }: { bottomPadding: number }) {
  const { colors, scheme } = useTheme();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search.trim(), 300);

  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });
  const catalog = useInfiniteQuery({
    queryKey: ["catalog", { q, tag }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.searchCatalog({ q: q || undefined, tag: tag ?? undefined, page: pageParam, pageSize: PAGE_SIZE }),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });

  // Uploaded records not yet identified/approved. No artist/title to match a
  // search or tag against, so they only show in the unfiltered view.
  const unidentified = useQuery({
    queryKey: ["captures", "unidentified"],
    queryFn: () => api.listUnidentified(),
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.status === "processing" || c.status === "review") ? 5000 : false,
  });
  const [openCapture, setOpenCapture] = useState<CaptureRef | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const trashCount = useQuery({ queryKey: ["trash"], queryFn: () => api.listTrash() }).data?.items.length ?? 0;
  const showUnidentified = !q && !tag && (unidentified.data?.length ?? 0) > 0;

  const items = catalog.data?.pages.flatMap((p) => p.items) ?? [];
  const total = catalog.data?.pages[0]?.total;

  // Selection mode (long-press a card): tick several, then trash together.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<string, TrashRef>>(new Map());
  const toggle = (r: TrashRef) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(keyOf(r))) next.delete(keyOf(r));
      else next.set(keyOf(r), r);
      if (next.size === 0) setSelecting(false); // deselecting the last one exits
      return next;
    });
  const startSelecting = (r: TrashRef) => {
    setSelecting(true);
    setSelected(new Map([[keyOf(r), r]]));
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Map());
  };
  const visible: TrashRef[] = [
    ...(showUnidentified ? unidentified.data!.map((c) => ({ kind: "capture" as const, id: c.id })) : []),
    ...items.map((e) => ({ kind: "entry" as const, id: e.id })),
  ];
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(keyOf(r)));

  const refreshAfterTrash = useRefreshAfterTrash();
  const [undoable, setUndoable] = useState<TrashRef[] | null>(null);
  useEffect(() => {
    if (!undoable) return;
    const t = setTimeout(() => setUndoable(null), 6000);
    return () => clearTimeout(t);
  }, [undoable]);
  const trash = useMutation({
    mutationFn: async (refs: TrashRef[]) => {
      await Promise.all(refs.map((r) => (r.kind === "entry" ? api.trashCatalogEntry(r.id) : api.trashCapture(r.id))));
      return refs;
    },
    onSuccess: (refs) => {
      refreshAfterTrash();
      stopSelecting();
      setUndoable(refs);
    },
    onError: refreshAfterTrash,
  });
  const undo = useMutation({
    mutationFn: (refs: TrashRef[]) => Promise.all(refs.map((r) => api.restoreFromTrash(r.kind, r.id))),
    onSuccess: () => {
      refreshAfterTrash();
      setUndoable(null);
    },
  });
  const confirmTrash = () => {
    const n = selected.size;
    Alert.alert(
      `Move ${n} item${n === 1 ? "" : "s"} to the trash?`,
      "They'll be removed from your catalog. You can restore them from the Trash for 30 days.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Move to trash", style: "destructive", onPress: () => trash.mutate([...selected.values()]) },
      ],
    );
  };
  const cardSelection = (r: TrashRef) => ({
    selecting,
    selected: selected.has(keyOf(r)),
    onLongPress: () => (selecting ? toggle(r) : startSelecting(r)),
  });

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text variant="heading">Catalog</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          {total !== undefined && <Text variant="label">{total} records</Text>}
          <Pressable
            onPress={() => setTrashOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Trash, ${trashCount} items`}
            style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
          >
            <Feather name="trash-2" size={14} color={colors.mutedForeground} />
            <Text variant="label">{trashCount > 0 ? `Trash · ${trashCount}` : "Trash"}</Text>
          </Pressable>
        </View>
      </View>
      {visible.length > 0 && !selecting && (
        <Text variant="muted" style={{ fontSize: 12, marginTop: -6 }}>
          Long-press a record to select and delete.
        </Text>
      )}
      <View
        style={[
          styles.search,
          { borderColor: colors.input, backgroundColor: scheme === "dark" ? colors.muted : colors.card },
        ]}
      >
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search artist or title…"
          placeholderTextColor={colors.mutedForeground}
          keyboardAppearance={scheme}
          selectionColor={colors.primary}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.sans, fontSize: 15 }}
        />
      </View>
      {tags.data && tags.data.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Chip label="All" selected={tag === null} onPress={() => setTag(null)} />
          {tags.data.map((t) => (
            <Chip
              key={t.name}
              label={`${t.name} · ${t.count}`}
              selected={tag?.toLowerCase() === t.name.toLowerCase()}
              onPress={() => setTag(tag?.toLowerCase() === t.name.toLowerCase() ? null : t.name)}
            />
          ))}
        </ScrollView>
      )}
      {showUnidentified && (
        <View style={{ gap: 8, paddingTop: 4 }}>
          <Text variant="label">Not identified yet · {unidentified.data!.length}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {unidentified.data!.map((c) => (
              <UnidentifiedCard
                key={c.id}
                capture={c}
                {...cardSelection({ kind: "capture", id: c.id })}
                onPress={() =>
                  selecting ? toggle({ kind: "capture", id: c.id }) : setOpenCapture({ kind: "uploaded", id: c.id })
                }
              />
            ))}
          </View>
          {items.length > 0 && <Text variant="label" style={{ marginTop: 8 }}>In your catalog</Text>}
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={(e) => e.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{
          padding: 16,
          paddingTop: 20,
          gap: 16,
          paddingBottom: bottomPadding + (selecting || undoable ? 72 : 0),
        }}
        ListHeaderComponent={header}
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (catalog.hasNextPage && !catalog.isFetchingNextPage) void catalog.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={catalog.isRefetching && !catalog.isFetchingNextPage}
            onRefresh={() => {
              void catalog.refetch();
              void tags.refetch();
              void unidentified.refetch();
            }}
            tintColor={colors.primary}
          />
        }
        extraData={selected}
        renderItem={({ item }) => (
          <RecordCard
            entry={item}
            {...cardSelection({ kind: "entry", id: item.id })}
            onPress={() => (selecting ? toggle({ kind: "entry", id: item.id }) : setOpenId(item.id))}
          />
        )}
        ListEmptyComponent={
          showUnidentified ? undefined : catalog.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : catalog.isError ? (
            <Text variant="error" style={{ textAlign: "center", marginTop: 40 }}>
              Couldn't load the catalog. Pull to retry.
            </Text>
          ) : (
            <View style={[styles.empty, { borderColor: colors.input }]}>
              <Text style={{ fontFamily: fonts.sansMedium }}>No records found</Text>
              <Text variant="muted">
                {q || tag ? "Try a different search or tag." : "Your catalog is empty — capture a record to start."}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          catalog.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} /> : undefined
        }
      />
      <Modal
        visible={openId !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenId(null)}
      >
        {openId && <RecordDetail id={openId} onClose={() => setOpenId(null)} />}
      </Modal>
      <Modal
        visible={openCapture !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenCapture(null)}
      >
        {openCapture && <CaptureDetail target={openCapture} onClose={() => setOpenCapture(null)} />}
      </Modal>
      <Modal
        visible={trashOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTrashOpen(false)}
      >
        <TrashScreen onClose={() => setTrashOpen(false)} />
      </Modal>

      {selecting && (
        <View style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ gap: 2 }}>
            <Text style={{ fontFamily: fonts.monoSemiBold, fontSize: 13 }}>{selected.size} selected</Text>
            <View style={{ flexDirection: "row", gap: 16 }}>
              <Pressable
                hitSlop={8}
                onPress={() => setSelected(allSelected ? new Map() : new Map(visible.map((r) => [keyOf(r), r])))}
              >
                <Text variant="label" style={{ color: colors.primary }}>
                  {allSelected ? "Select none" : "Select all"}
                </Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={stopSelecting}>
                <Text variant="label">Cancel</Text>
              </Pressable>
            </View>
          </View>
          <Pressable
            onPress={confirmTrash}
            disabled={selected.size === 0 || trash.isPending}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.trashBtn,
              { backgroundColor: colors.destructive, opacity: selected.size === 0 ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            {trash.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="trash-2" size={16} color="#fff" />
                <Text style={{ fontFamily: fonts.sansMedium, color: "#fff" }}>Move to trash</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      {!selecting && undoable && (
        <View style={[styles.bar, { backgroundColor: colors.foreground, borderColor: colors.foreground }]}>
          <Text style={{ color: colors.background, flex: 1 }} numberOfLines={1}>
            Moved {undoable.length === 1 ? "1 item" : `${undoable.length} items`} to the trash
          </Text>
          <Pressable onPress={() => undo.mutate(undoable)} hitSlop={10} disabled={undo.isPending}>
            <Text variant="label" style={{ color: colors.primary, fontSize: 13 }}>
              {undo.isPending ? "Restoring…" : "Undo"}
            </Text>
          </Pressable>
        </View>
      )}
      {trash.isError && !selecting && (
        <Text variant="error" style={{ position: "absolute", bottom: 12, left: 16, right: 16 }}>
          Couldn't move everything to the trash. Pull to refresh and try again.
        </Text>
      )}
    </View>
  );
}

type TrashRef = { kind: TrashKind; id: string };
const keyOf = (r: TrashRef) => `${r.kind}:${r.id}`;

interface SelectionProps {
  selecting: boolean;
  selected: boolean;
  onLongPress: () => void;
}

/** Tick box shown on cards in selection mode. */
function SelectionMark({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        width: 24,
        height: 24,
        borderRadius: radius.sm,
        borderWidth: 2,
        borderColor: selected ? colors.primary : "rgba(255,255,255,0.9)",
        backgroundColor: selected ? colors.primary : "rgba(0,0,0,0.3)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {selected && <Feather name="check" size={15} color={colors.primaryForeground} />}
    </View>
  );
}

/** Badge copy + palette colour for records not in the catalog yet. */
const UNIDENTIFIED_BADGE: Partial<Record<Capture["status"], { label: string; color: string }>> = {
  processing: { label: "Reading photos…", color: palette.mustardYellow },
  review: { label: "Checking Discogs…", color: palette.harvestGold },
  pending_single: { label: "Match found", color: palette.avocadoGreen },
  pending_multiple: { label: "Pick a match", color: palette.tealBlue },
  pending_nomatch: { label: "Ready to approve", color: palette.rustRed },
};

/** The owner's own photo in a dashed frame with a status badge. */
function UnidentifiedCard({
  capture,
  onPress,
  selecting,
  selected,
  onLongPress,
}: { capture: Capture; onPress: () => void } & SelectionProps) {
  const { colors } = useTheme();
  const badge = UNIDENTIFIED_BADGE[capture.status] ?? { label: capture.status, color: colors.mutedForeground };
  const photo = capture.photos.find((p) => p.type === "front") ?? capture.photos[0];
  const top = capture.candidates[0]?.release;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected } : undefined}
      accessibilityLabel={`Unidentified record, ${badge.label}`}
      accessibilityHint={selecting ? "Toggles selection" : "Long-press to select"}
      style={({ pressed }) => [{ width: "47%", flexGrow: 1, maxWidth: "50%", gap: 6, opacity: pressed ? 0.8 : 1 }]}
    >
      <View
        style={[
          styles.cover,
          { backgroundColor: colors.muted, borderColor: colors.input, borderStyle: "dashed", borderWidth: 1 },
          selected && { borderColor: colors.primary, borderWidth: 3, borderStyle: "solid" },
        ]}
      >
        {photo ? (
          <Image source={imageSource(photo.url)} style={[StyleSheet.absoluteFill, { opacity: 0.85 }]} resizeMode="cover" />
        ) : (
          <Feather name="disc" size={32} color={colors.mutedForeground} />
        )}
        <View style={[styles.badge, { backgroundColor: colors.background }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: badge.color }} />
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.foreground }}>{badge.label}</Text>
        </View>
        {selecting && <SelectionMark selected={selected} />}
      </View>
      <View>
        <Text numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14 }}>
          {top ? top.artist : "Unidentified record"}
        </Text>
        <Text variant="muted" numberOfLines={1} style={{ fontSize: 13 }}>
          {top ? `${top.title} · not approved` : `Uploaded ${new Date(capture.createdAt).toLocaleDateString()}`}
        </Text>
      </View>
    </Pressable>
  );
}

function RecordCard({
  entry,
  onPress,
  selecting,
  selected,
  onLongPress,
}: { entry: CatalogEntry; onPress: () => void } & SelectionProps) {
  const { colors } = useTheme();
  const cover = coverOf(entry);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected } : undefined}
      accessibilityLabel={`${entry.release.artist}, ${entry.release.title}`}
      accessibilityHint={selecting ? "Toggles selection" : "Long-press to select"}
      style={({ pressed }) => [{ flex: 1, maxWidth: "50%", gap: 6, opacity: pressed ? 0.8 : 1 }]}
    >
      <View
        style={[
          styles.cover,
          { backgroundColor: colors.muted, borderColor: colors.border },
          selected && { borderColor: colors.primary, borderWidth: 3 },
        ]}
      >
        {cover ? (
          <Image source={imageSource(cover)} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Feather name="disc" size={32} color={colors.mutedForeground} />
        )}
        {selecting && <SelectionMark selected={selected} />}
      </View>
      <View>
        <Text numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14 }}>
          {entry.release.artist}
        </Text>
        <Text variant="muted" numberOfLines={1} style={{ fontSize: 13 }}>
          {entry.release.title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  cover: {
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  bar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  trashBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    opacity: 0.94,
  },
  empty: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 48,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.lg,
  },
});
