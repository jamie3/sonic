import { Feather } from "@expo/vector-icons";
import { SonicApiError } from "@sonic/api-client";
import type {
  Capture,
  CaptureStatus,
  CatalogEntry,
  FieldAgreement,
  IdentificationCandidate,
  ManualRelease,
} from "@sonic/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { api } from "../api.js";
import { useTheme } from "../theme/ThemeProvider.js";
import { fonts, palette, radius } from "../theme/tokens.js";
import { Button, Card, Field, Text } from "../ui/index.js";

/** Statuses where the owner can approve (a Discogs match or what was read). */
export const AWAITING_APPROVAL: CaptureStatus[] = ["pending_single", "pending_multiple", "pending_nomatch"];
export const isAwaitingApproval = (s: CaptureStatus) => AWAITING_APPROVAL.includes(s);

/** Best name for a capture: top Discogs candidate, else what was read, else its id. */
export function captureTitle(c: Capture): string {
  const top = c.candidates[0]?.release;
  if (top) return `${top.artist} — ${top.title}`;
  const f = c.extraction?.fields;
  if (f?.artist || f?.title) return [f.artist, f.title].filter(Boolean).join(" — ");
  return `Capture ${c.id.slice(0, 8)}`;
}

/** Everything that shows captures or the catalog refreshes after an approval or re-scan. */
export function useRefreshAfterApprove() {
  const qc = useQueryClient();
  return () => {
    for (const key of [["captures"], ["capture"], ["catalog"], ["tags"], ["catalog-entry"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

/**
 * Readable message from an API failure. The server answers errors as
 * `{ "error": "…" }`; the client passes the raw body through as the message.
 */
export function apiErrorMessage(e: unknown, action: string): string {
  if (e instanceof SonicApiError) {
    let detail = e.message;
    try {
      const body = JSON.parse(e.message) as { error?: unknown };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      // Not JSON — use the text as is.
    }
    if (e.status === 409) {
      return `Couldn't ${action}: ${detail}. It may have changed elsewhere (e.g. approved in the web app) — the capture has been refreshed.`;
    }
    if (e.status === 401) return `Couldn't ${action}: your session has expired. Sign in again.`;
    return `Couldn't ${action}: ${detail}`;
  }
  if (e instanceof Error) return `Couldn't ${action}: ${e.message}`;
  return `Couldn't ${action}. Try again.`;
}

/**
 * Approve a capture awaiting a decision, mirroring the web Review queue:
 * pick a Discogs candidate (top one by default) and "Approve match", or
 * "None of these are right — use what was read" → the AI's reading, editable,
 * approved via resolve. "Re-scan" sends it back to the matcher (status
 * "review"); the parent polls until the new result lands.
 */
export function ApproveSection({
  capture,
  onApproved,
}: {
  capture: Capture;
  onApproved: (entry: CatalogEntry) => void;
}) {
  const { colors } = useTheme();
  const refresh = useRefreshAfterApprove();
  const [chosen, setChosen] = useState<string | null>(capture.candidates[0]?.id ?? null);
  // "None of these are right — use what was read."
  const [manual, setManual] = useState(false);

  // After a re-scan the candidate ids change; fall back to the new top one.
  const chosenId = capture.candidates.some((c) => c.id === chosen) ? chosen : (capture.candidates[0]?.id ?? null);
  const hasCandidates = capture.candidates.length > 0;

  const approve = useMutation({
    mutationFn: (candidateId: string) => api.approve(capture.id, { candidateId }),
    onSuccess: (entry) => {
      refresh();
      onApproved(entry);
    },
    onError: refresh, // e.g. 409: someone else already approved it — show the current state
  });
  const rescan = useMutation({
    mutationFn: () => api.rescan(capture.id),
    onSuccess: () => {
      setManual(false);
      refresh();
    },
    onError: refresh,
  });

  const busy = approve.isPending || rescan.isPending;

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.headRow}>
        <Text variant="label">Approve</Text>
        <Pressable
          onPress={() => rescan.mutate()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Re-scan"
          accessibilityHint="Searches Discogs again with what was read from the photos"
          accessibilityState={{ disabled: busy, busy: rescan.isPending }}
          style={({ pressed }) => [
            styles.smallAction,
            { borderColor: colors.input, backgroundColor: pressed ? colors.accent : colors.card, opacity: busy ? 0.5 : 1 },
          ]}
        >
          <Feather name="refresh-cw" size={14} color={colors.foreground} />
          <Text variant="label" style={{ color: colors.foreground }}>
            {rescan.isPending ? "Re-scanning…" : "Re-scan"}
          </Text>
        </Pressable>
      </View>
      {rescan.isError && <Text variant="error">{apiErrorMessage(rescan.error, "re-scan")}</Text>}

      {hasCandidates && !manual ? (
        <>
          <Text variant="muted">
            {capture.status === "pending_single"
              ? "Discogs match — check it agrees with what was read, then approve."
              : `${capture.candidates.length} possible Discogs matches — pick the right one.`}
          </Text>
          {capture.match?.message ? (
            <Text variant="muted" style={{ fontSize: 12 }}>
              {capture.match.message}
            </Text>
          ) : null}
          <Card accessibilityRole="radiogroup">
            {capture.candidates.map((cand, i) => (
              <CandidateRow
                key={cand.id}
                candidate={cand}
                first={i === 0}
                selected={chosenId === cand.id}
                onPress={() => setChosen(cand.id)}
              />
            ))}
          </Card>
          {approve.isError && <Text variant="error">{apiErrorMessage(approve.error, "approve this capture")}</Text>}
          <Button
            title={approve.isPending ? "Approving…" : "Approve match"}
            loading={approve.isPending}
            disabled={!chosenId || rescan.isPending}
            onPress={() => chosenId && approve.mutate(chosenId)}
          />
          <Button
            title="None of these are right — use what was read"
            variant="ghost"
            disabled={busy}
            onPress={() => setManual(true)}
          />
        </>
      ) : (
        <>
          <MatchNote capture={capture} />
          <ManualApproveForm
            key={capture.id}
            capture={capture}
            disabled={rescan.isPending}
            onApproved={onApproved}
            onCancel={hasCandidates ? () => setManual(false) : undefined}
          />
        </>
      )}
    </View>
  );
}

const FIELD_LABEL: Record<FieldAgreement["field"], string> = {
  barcode: "Barcode",
  catalogNumber: "Cat. no.",
  artist: "Artist",
  title: "Title",
  label: "Label",
  year: "Year",
};

const AGREEMENT_STYLE = {
  match: { symbol: "✓", color: palette.avocadoGreen, word: "agrees" },
  partial: { symbol: "≈", color: palette.mustardYellow, word: "partly agrees" },
  mismatch: { symbol: "✗", color: palette.rustRed, word: "differs" },
} as const;

/** One Discogs candidate (radio row): release, score, per-field agreement with what was read. */
function CandidateRow({
  candidate,
  first,
  selected,
  onPress,
}: {
  candidate: IdentificationCandidate;
  first: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const r = candidate.release;
  const meta = [r.year, r.country, r.label, r.catalogNumber].filter(Boolean).join(" · ");
  const compared = candidate.agreement.filter(
    (a): a is FieldAgreement & { agreement: keyof typeof AGREEMENT_STYLE } => a.agreement !== "missing",
  );
  const pct = candidate.score != null ? Math.round(candidate.score * 100) : null;
  const a11y = [
    `${r.artist} — ${r.title}`,
    meta,
    r.format,
    pct != null ? `${pct}% match` : null,
    ...compared.map((a) => `${FIELD_LABEL[a.field]} ${AGREEMENT_STYLE[a.agreement].word}`),
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={a11y}
      style={({ pressed }) => [
        styles.candidate,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
        selected && { backgroundColor: colors.accent },
        pressed && !selected && { backgroundColor: colors.muted },
      ]}
    >
      <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.input }]}>
        {selected && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
      </View>
      {r.thumbUrl ? (
        <Image source={{ uri: r.thumbUrl }} style={[styles.thumb, { borderColor: colors.border }]} />
      ) : null}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Text style={{ flex: 1, fontFamily: fonts.sansMedium, fontSize: 14 }} numberOfLines={2}>
            {r.artist} — {r.title}
          </Text>
          {pct != null && (
            <View
              style={[
                styles.score,
                {
                  backgroundColor: `${pct >= 75 ? palette.avocadoGreen : pct >= 50 ? palette.mustardYellow : palette.rustRed}40`,
                },
              ]}
            >
              <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.foreground }}>{pct}% match</Text>
            </View>
          )}
        </View>
        {meta ? (
          <Text variant="muted" style={{ fontSize: 12 }} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
        {r.format ? (
          <Text variant="muted" style={{ fontSize: 12 }} numberOfLines={1}>
            {r.format}
          </Text>
        ) : null}
        {compared.length > 0 && (
          <View style={styles.chips}>
            {compared.map((a) => {
              const s = AGREEMENT_STYLE[a.agreement];
              return (
                <View key={a.field} style={[styles.chip, { backgroundColor: `${s.color}33` }]}>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.foreground }}>
                    {s.symbol} {FIELD_LABEL[a.field]}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** Why there are no candidates: nothing found, Discogs not configured, or an error. */
function MatchNote({ capture }: { capture: Capture }) {
  const { colors } = useTheme();
  const m = capture.match;
  if (!m) return null;
  return (
    <View style={[styles.note, { borderColor: colors.input }]}>
      <Text variant={m.outcome === "error" ? "error" : "muted"}>
        {m.message ?? (m.outcome === "matched" ? "Matched on Discogs." : "No match found.")}
      </Text>
      {m.queries.length > 0 && (
        <Text variant="label" style={{ textTransform: "none" }}>
          Searched: {m.queries.join(" · ")}
        </Text>
      )}
      <Text variant="muted" style={{ fontSize: 12 }}>
        Check the details below, correct anything wrong, and approve.
      </Text>
    </View>
  );
}

type FormKey = "artist" | "title" | "label" | "catalogNumber" | "barcode" | "year" | "country" | "format";
const FORM_FIELDS: { key: FormKey; label: string; required?: boolean; numeric?: boolean }[] = [
  { key: "artist", label: "Artist", required: true },
  { key: "title", label: "Title", required: true },
  { key: "label", label: "Label" },
  { key: "catalogNumber", label: "Catalog no." },
  { key: "barcode", label: "Barcode", numeric: true },
  { key: "year", label: "Year", numeric: true },
  { key: "country", label: "Country" },
  { key: "format", label: "Format" },
];

/** The AI's reading, editable, approved as a hand-confirmed release (resolve). */
function ManualApproveForm({
  capture,
  disabled,
  onApproved,
  onCancel,
}: {
  capture: Capture;
  disabled?: boolean;
  onApproved: (entry: CatalogEntry) => void;
  onCancel?: () => void;
}) {
  const refresh = useRefreshAfterApprove();
  const f = capture.extraction?.fields;
  const [form, setForm] = useState<Record<FormKey, string>>({
    artist: f?.artist ?? "",
    title: f?.title ?? "",
    label: f?.label ?? "",
    catalogNumber: f?.catalogNumber ?? "",
    barcode: f?.barcode ?? capture.barcodeHint ?? "",
    year: f?.year != null ? String(f.year) : "",
    country: f?.country ?? "",
    format: f?.format ?? "",
  });
  const year = form.year.trim();

  const resolve = useMutation({
    mutationFn: () => {
      const manual: ManualRelease = {
        artist: form.artist.trim(),
        title: form.title.trim(),
        label: form.label.trim() || null,
        catalogNumber: form.catalogNumber.trim() || null,
        barcode: form.barcode.trim() || null,
        year: year ? Number(year) : null,
        country: form.country.trim() || null,
        format: form.format.trim() || null,
        tracklist: f?.tracklist ?? [],
      };
      return api.resolve(capture.id, { manual });
    },
    onSuccess: (entry) => {
      refresh();
      onApproved(entry);
    },
    onError: refresh,
  });

  const yearInvalid = year !== "" && !/^\d{1,4}$/.test(year);
  const missingRequired = !form.artist.trim() || !form.title.trim();
  const invalid = missingRequired || yearInvalid;

  return (
    <View style={{ gap: 12 }}>
      {FORM_FIELDS.map(({ key, label, required, numeric }) => (
        <Field
          key={key}
          label={required ? `${label} *` : label}
          accessibilityLabel={required ? `${label}, required` : label}
          value={form[key]}
          onChangeText={(v) => setForm((s) => ({ ...s, [key]: v }))}
          keyboardType={numeric ? "number-pad" : "default"}
          autoCapitalize={key === "catalogNumber" ? "characters" : key === "barcode" || key === "year" ? "none" : "words"}
          autoCorrect={false}
          maxLength={key === "year" ? 4 : undefined}
          editable={!resolve.isPending}
        />
      ))}
      {f && f.tracklist.length > 0 && (
        <Text variant="muted" style={{ fontSize: 12 }}>
          {f.tracklist.length} tracks read from the photos will be kept.
        </Text>
      )}
      {missingRequired && <Text variant="muted" style={{ fontSize: 12 }}>Artist and title are required.</Text>}
      {yearInvalid && <Text variant="error">Year must be a number, e.g. 1977.</Text>}
      {resolve.isError && <Text variant="error">{apiErrorMessage(resolve.error, "approve this capture")}</Text>}
      <Button
        title={resolve.isPending ? "Approving…" : "Approve to catalog"}
        loading={resolve.isPending}
        disabled={invalid || disabled}
        onPress={() => resolve.mutate()}
      />
      {onCancel && (
        <Button title="Back to Discogs matches" variant="ghost" disabled={resolve.isPending} onPress={onCancel} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  smallAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  candidate: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, minHeight: 56 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  thumb: { width: 48, height: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  score: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  note: { gap: 6, padding: 12, borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md },
});
