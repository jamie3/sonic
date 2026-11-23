import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, imageSource } from "../api.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { fonts, radius } from "../theme/tokens.js";
import { Button, Card, DetailRow, IconButton, RetroStripe, Text } from "../ui/index.js";
import { useRefreshAfterTrash } from "./TrashScreen.js";
import { coverOf } from "./cover.js";

const PHOTO_LABEL: Record<string, string> = {
  front: "Front",
  back: "Back",
  label_a: "Label A",
  label_b: "Label B",
  spine: "Spine",
};

/** Read-only record detail (editing lives in the web app). */
export function RecordDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: entry, isLoading, isError } = useQuery({
    queryKey: ["catalog-entry", id],
    queryFn: () => api.getCatalogEntry(id),
  });
  const refresh = useRefreshAfterTrash();
  const trash = useMutation({
    mutationFn: () => api.trashCatalogEntry(id),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const confirmTrash = () =>
    Alert.alert(
      "Move to trash?",
      `“${entry?.release.title ?? "This record"}” will be removed from your catalog. You can restore it from the Trash for 30 days.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Move to trash", style: "destructive", onPress: () => trash.mutate() },
      ],
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RetroStripe height={6} />
      <View style={[styles.bar, { borderBottomColor: colors.border }]}>
        <Text variant="label">Record</Text>
        <IconButton icon="x" label="Close" onPress={onClose} />
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : isError || !entry ? (
        <Text variant="error" style={{ textAlign: "center", marginTop: 40 }}>
          Couldn't load this record.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 32 }}>
          <View style={[styles.cover, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            {coverOf(entry) ? (
              <Image source={imageSource(coverOf(entry)!)} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <Feather name="disc" size={56} color={colors.mutedForeground} />
            )}
          </View>

          <View style={{ gap: 4 }}>
            <Text variant="heading" style={{ fontSize: 26 }}>
              {entry.release.title}
            </Text>
            <Text variant="muted" style={{ fontSize: 17 }}>
              {entry.release.artist}
            </Text>
          </View>

          {entry.tags.length > 0 && (
            <View style={styles.tags}>
              {entry.tags.map((t) => (
                <View key={t} style={[styles.tag, { backgroundColor: colors.secondary }]}>
                  <Feather name="tag" size={11} color={colors.secondaryForeground} />
                  <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.secondaryForeground }}>{t}</Text>
                </View>
              ))}
            </View>
          )}

          <Section title="Release">
            <DetailRow label="Label" value={entry.release.label} />
            <DetailRow label="Catalog no." value={entry.release.catalogNumber} mono />
            <DetailRow label="Year" value={entry.release.year?.toString()} />
            <DetailRow label="Country" value={entry.release.country} />
            <DetailRow label="Format" value={entry.release.format} />
            <DetailRow label="Barcode" value={entry.release.barcode} mono />
          </Section>

          <Section title="Your copy">
            <DetailRow label="Condition" value={entry.condition} mono />
            <DetailRow label="Location" value={entry.location} />
            <DetailRow
              label="Paid"
              value={entry.purchasePrice != null ? entry.purchasePrice.toFixed(2) : null}
              mono
            />
            <DetailRow label="Bought" value={entry.purchaseDate} mono />
            {entry.notes ? (
              <View style={{ paddingVertical: 10, gap: 4 }}>
                <Text variant="label">Notes</Text>
                <Text>{entry.notes}</Text>
              </View>
            ) : null}
          </Section>

          {entry.photos.length > 0 && (
            <Section title="Your photos">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {entry.photos.map((p) => (
                  <View key={p.id} style={{ gap: 4 }}>
                    <Image
                      source={imageSource(p.url)}
                      style={[styles.photo, { borderColor: colors.border }]}
                      resizeMode="cover"
                    />
                    <Text variant="label">{PHOTO_LABEL[p.type] ?? p.type}</Text>
                  </View>
                ))}
              </ScrollView>
            </Section>
          )}

          {entry.release.tracklist.length > 0 && (
            <Section title="Tracklist">
              <Card>
                {entry.release.tracklist.map((t, i) => (
                  <View
                    key={`${t.position}-${i}`}
                    style={[
                      styles.track,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                    ]}
                  >
                    <Text variant="mono" style={{ width: 36, color: colors.mutedForeground }}>
                      {t.position}
                    </Text>
                    <Text style={{ flex: 1 }} numberOfLines={2}>
                      {t.title}
                    </Text>
                    {t.duration ? (
                      <Text variant="mono" style={{ color: colors.mutedForeground }}>
                        {t.duration}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </Card>
            </Section>
          )}

          <Text variant="muted" style={{ fontSize: 12, textAlign: "center" }}>
            Edit details and tags in the web app.
          </Text>
          {trash.isError && <Text variant="error">Couldn't move it to the trash. Try again.</Text>}
          <Button title="Move to trash" variant="outline" onPress={confirmTrash} loading={trash.isPending} />
        </ScrollView>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{title}</Text>
      <View>{children}</View>
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
  cover: {
    aspectRatio: 1,
    width: "100%",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  photo: { width: 120, height: 120, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  track: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
});
