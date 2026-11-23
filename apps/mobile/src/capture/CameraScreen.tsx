import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider.js";
import { fonts, palette, radius } from "../theme/tokens.js";
import { Button, LogoMark, RetroStripe, Text as ThemedText } from "../ui/index.js";
import { guideRect, type Rect, type Size, viewRectToImageCrop } from "./framing.js";
import { prepareForUpload } from "./prepare.js";
import type { ShotSpec, TakenPhoto } from "./shots.js";

// Retail barcodes only — QR etc. on inserts would just be noise.
const BARCODE_TYPES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

interface Props {
  shots: ShotSpec[];
  /** Photos already taken (e.g. when re-shooting one), keyed by type. */
  initial?: TakenPhoto[];
  initialBarcode?: string | null;
  onDone: (photos: TakenPhoto[], barcode: string | null) => void;
  onCancel: () => void;
}

/**
 * Guided camera: walks through each shot in order, scanning for a retail
 * barcode the whole time. Required shots can't be skipped.
 */
export function CameraScreen({ shots, initial = [], initialBarcode = null, onDone, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const camera = useRef<CameraView>(null);
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<TakenPhoto[]>(initial);
  const [barcode, setBarcode] = useState<string | null>(initialBarcode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Layout for the square framing guide (measured, since the prompt card's
  // height varies with the hint text).
  const [view, setView] = useState<Size | null>(null);
  const [promptBottom, setPromptBottom] = useState<number | null>(null);

  if (!permission) return <View style={styles.fill} />;
  if (!permission.granted) {
    return (
      <View style={[styles.center, { flex: 1, padding: 24, gap: 16, backgroundColor: colors.background }]}>
        <LogoMark size={44} />
        <ThemedText variant="body" style={{ textAlign: "center" }}>
          Sonic needs the camera to photograph your records.
        </ThemedText>
        <Button title="Allow camera" onPress={requestPermission} style={{ alignSelf: "stretch" }} />
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ alignSelf: "stretch" }} />
      </View>
    );
  }

  const shot = shots[step]!;
  const isLast = step === shots.length - 1;
  // Square guide sits between the prompt card and the reserved bottom area
  // (thumbnail strip + shutter row).
  const guide =
    shot.square && view && promptBottom !== null
      ? guideRect(view, promptBottom, view.height - (insets.bottom + BOTTOM_RESERVED))
      : null;
  const hasRequired = shots.filter((s) => s.required).every((s) => photos.some((p) => p.type === s.type));

  function advance(next: TakenPhoto[]) {
    if (isLast) onDone(next, barcode);
    else setStep(step + 1);
  }

  async function shoot() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.9 });
      if (!pic) throw new Error("No photo returned");
      // Keep only what was inside the guide: a clean square sleeve/label.
      const crop =
        guide && view ? viewRectToImageCrop(guide, view, { width: pic.width, height: pic.height }) : undefined;
      const uri = await prepareForUpload(pic.uri, pic.width, pic.height, crop);
      const next = [...photos.filter((p) => p.type !== shot.type), { type: shot.type, uri }];
      setPhotos(next);
      advance(next);
    } catch (e) {
      setError((e instanceof Error && e.message) || "Couldn't take photo");
    } finally {
      setBusy(false);
    }
  }

  function onBarcode(result: BarcodeScanningResult) {
    if (/^\d{8,14}$/.test(result.data)) setBarcode(result.data);
  }

  const taken = photos.find((p) => p.type === shot.type);

  return (
    <View style={styles.fill} onLayout={(e) => setView(e.nativeEvent.layout)}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        // Stop listening once we have one — avoids a re-render per frame.
        onBarcodeScanned={barcode ? undefined : onBarcode}
      />
      {guide ? <GuideOverlay rect={guide} /> : null}

      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.topText}>Cancel</Text>
        </Pressable>
        <Text style={styles.counter}>
          {step + 1} / {shots.length}
        </Text>
      </View>

      <View
        style={[styles.prompt, { top: insets.top + 52 }]}
        onLayout={(e) => setPromptBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      >
        <RetroStripe height={6} />
        <View style={styles.promptBody}>
        <Text style={styles.promptTitle}>
          {shot.label}
          {taken ? " ✓" : ""}
        </Text>
        <Text style={styles.promptHint}>{shot.hint}</Text>
        {barcode ? <Text style={styles.barcode}>Barcode {barcode}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </View>

      <View style={[styles.bottomBar, { bottom: insets.bottom + 32 }]}>
        <View style={styles.side}>
          {step > 0 && (
            <Pressable onPress={() => setStep(step - 1)} hitSlop={12}>
              <Text style={styles.topText}>Back</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          style={[styles.shutter, busy && { opacity: 0.5 }]}
          onPress={shoot}
          disabled={busy}
          accessibilityLabel={`Take ${shot.label} photo`}
        >
          {busy ? <ActivityIndicator color={palette.harvestOrange} /> : <View style={styles.shutterInner} />}
        </Pressable>

        <View style={[styles.side, { alignItems: "flex-end" }]}>
          {isLast && hasRequired ? (
            <Pressable onPress={() => onDone(photos, barcode)} hitSlop={12}>
              <Text style={styles.topText}>Done</Text>
            </Pressable>
          ) : !shot.required || taken ? (
            <Pressable onPress={() => advance(photos)} hitSlop={12}>
              <Text style={styles.topText}>{taken ? "Next" : "Skip"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {photos.length > 0 && (
        <View style={[styles.thumbs, { bottom: insets.bottom + 124 }]}>
          {shots.map((s) => {
            const p = photos.find((x) => x.type === s.type);
            return p ? <Image key={s.type} source={{ uri: p.uri }} style={styles.thumb} /> : null;
          })}
        </View>
      )}
    </View>
  );
}

/** Space kept clear above the bottom inset: shutter row + thumbnail strip. */
const BOTTOM_RESERVED = 124 + 44 + 8;
const BRACKET = 28;
const BRACKET_W = 3;

/**
 * Dims everything outside the square and draws orange corner brackets. The
 * photo is cropped to exactly this square (see framing.ts).
 */
function GuideOverlay({ rect }: { rect: Rect }) {
  const mask = "rgba(0, 0, 0, 0.55)";
  const { x, y, size } = rect;
  const corner = (pos: object, edges: object) => (
    <View style={[{ position: "absolute", width: BRACKET, height: BRACKET, borderColor: palette.harvestOrange }, pos, edges]} />
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: y, backgroundColor: mask }} />
      <View style={{ position: "absolute", left: 0, right: 0, top: y + size, bottom: 0, backgroundColor: mask }} />
      <View style={{ position: "absolute", left: 0, width: x, top: y, height: size, backgroundColor: mask }} />
      <View style={{ position: "absolute", left: x + size, right: 0, top: y, height: size, backgroundColor: mask }} />
      <View
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: size,
          height: size,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: "rgba(243, 238, 227, 0.5)",
        }}
      >
        {corner({ left: -1, top: -1 }, { borderLeftWidth: BRACKET_W, borderTopWidth: BRACKET_W })}
        {corner({ right: -1, top: -1 }, { borderRightWidth: BRACKET_W, borderTopWidth: BRACKET_W })}
        {corner({ left: -1, bottom: -1 }, { borderLeftWidth: BRACKET_W, borderBottomWidth: BRACKET_W })}
        {corner({ right: -1, bottom: -1 }, { borderRightWidth: BRACKET_W, borderBottomWidth: BRACKET_W })}
      </View>
    </View>
  );
}

// The viewfinder stays dark in both themes; brand shows through the type,
// the stripe-topped prompt card, and the Harvest Orange shutter.
const INK = "#f3eee3"; // cream, matching the dark theme's foreground
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center" },
  topBar: {
    position: "absolute",
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topText: { color: INK, fontSize: 16, fontFamily: fonts.sansMedium },
  counter: { color: INK, fontSize: 13, fontFamily: fonts.mono, letterSpacing: 1.3 },
  prompt: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "rgba(29, 21, 16, 0.78)", // dark theme background, translucent
  },
  promptBody: { padding: 12, gap: 4 },
  promptTitle: { color: INK, fontSize: 18, fontFamily: fonts.sansSemiBold },
  promptHint: { color: "#c2b096", fontSize: 14, fontFamily: fonts.sans },
  barcode: {
    color: palette.mustardYellow,
    fontSize: 12,
    fontFamily: fonts.monoSemiBold,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 4,
  },
  error: { color: "#e08a72", fontSize: 14, fontFamily: fonts.sans, marginTop: 4 },
  bottomBar: {
    position: "absolute",
    left: 24,
    right: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  side: { width: 72 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: INK,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: palette.harvestOrange },
  thumbs: { position: "absolute", left: 20, flexDirection: "row", gap: 6 },
  thumb: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: INK },
});
