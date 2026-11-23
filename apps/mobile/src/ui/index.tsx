/**
 * Themed primitives matching the web app's shadcn/industrial look: tight
 * corners, mono uppercase labels, Harvest Orange primary, retro stripe.
 */
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text as RNText,
  type TextProps as RNTextProps,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { type ThemePreference, useTheme } from "../theme/ThemeProvider.js";
import { fonts, radius, stripe } from "../theme/tokens.js";

// --- Text ---

type TextVariant = "title" | "heading" | "body" | "muted" | "label" | "mono" | "error";

export function Text({
  variant = "body",
  style,
  ...props
}: RNTextProps & { variant?: TextVariant }) {
  const { colors } = useTheme();
  const v: Record<TextVariant, TextStyle> = {
    title: { fontFamily: fonts.monoSemiBold, fontSize: 22, letterSpacing: 4.4, textTransform: "uppercase", color: colors.foreground },
    heading: { fontFamily: fonts.sansSemiBold, fontSize: 22, letterSpacing: -0.3, color: colors.foreground },
    body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, color: colors.foreground },
    muted: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
    // The web's `label-mono` utility: small uppercase mono "spec plate" text.
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.3, textTransform: "uppercase", color: colors.mutedForeground },
    mono: { fontFamily: fonts.mono, fontSize: 13, color: colors.foreground },
    error: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: colors.destructive },
  };
  return <RNText style={[v[variant], style]} {...props} />;
}

// --- Layout ---

/** Four stacked palette bands — the signature accent across headers/cards. */
export function RetroStripe({ height = 8 }: { height?: number }) {
  return (
    <View style={{ height }}>
      {stripe.map((color) => (
        <View key={color} style={{ flex: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}

export function Card({ style, children, ...props }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          overflow: "hidden",
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

/** Square dark tile with the disc mark — the web header's logo block. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm,
        backgroundColor: colors.foreground,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Feather name="disc" size={size * 0.57} color={colors.background} />
    </View>
  );
}

/** App header: stripe, logo + SONIC wordmark, and right-side actions. */
export function Header({ right }: { right?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.background }}>
      <RetroStripe height={8} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          height: 56,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <LogoMark />
          <Text style={{ fontFamily: fonts.monoSemiBold, fontSize: 14, letterSpacing: 2.8 }}>SONIC</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>{right}</View>
      </View>
    </View>
  );
}

export function IconButton({
  icon,
  label,
  ...props
}: PressableProps & { icon: React.ComponentProps<typeof Feather>["name"]; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.accent : "transparent",
      })}
      {...props}
    >
      <Feather name={icon} size={18} color={colors.foreground} />
    </Pressable>
  );
}

const NEXT_PREF: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const PREF_ICON = { system: "monitor", light: "sun", dark: "moon" } as const;

/** Cycles System → Light → Dark (the web uses a dropdown; same three modes). */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <IconButton
      icon={PREF_ICON[preference]}
      label={`Theme: ${preference}. Tap to switch to ${NEXT_PREF[preference]}.`}
      onPress={() => setPreference(NEXT_PREF[preference])}
    />
  );
}

// --- Controls ---

type ButtonVariant = "primary" | "outline" | "ghost";

export function Button({
  title,
  variant = "primary",
  loading,
  disabled,
  style,
  ...props
}: Omit<PressableProps, "style"> & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const fg =
    variant === "primary" ? colors.primaryForeground : variant === "outline" ? colors.foreground : colors.mutedForeground;
  return (
    <Pressable
      accessibilityRole="button"
      // Keeps the title readable to screen readers while the spinner shows.
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          // minHeight (not height) so a long title can wrap to two lines.
          minHeight: 44,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 16,
          paddingVertical: 8,
          opacity: disabled ? 0.5 : 1,
        },
        variant === "primary" && { backgroundColor: colors.primary },
        variant === "outline" && {
          borderWidth: 1,
          borderColor: colors.input,
          backgroundColor: pressed ? colors.accent : colors.card,
        },
        variant === "ghost" && pressed && { backgroundColor: colors.accent },
        variant === "primary" && pressed && { opacity: 0.85 },
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: fg, textAlign: "center" }}>{title}</Text>
      )}
    </Pressable>
  );
}

/**
 * Labelled text input. A password field (`secureTextEntry`) gets an eye button
 * that shows/hides what's typed.
 */
export function Field({
  label,
  style,
  secureTextEntry,
  ...props
}: TextInputProps & { label: string }) {
  const { colors, scheme } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!secureTextEntry;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="label">{label}</Text>
      <View style={{ justifyContent: "center" }}>
        <TextInput
          placeholderTextColor={colors.mutedForeground}
          keyboardAppearance={scheme}
          selectionColor={colors.primary}
          accessibilityLabel={label}
          secureTextEntry={isPassword && !revealed}
          style={[
            {
              height: 44,
              borderWidth: 1,
              borderColor: colors.input,
              borderRadius: radius.md,
              paddingHorizontal: 12,
              paddingRight: isPassword ? 48 : 12,
              backgroundColor: scheme === "dark" ? colors.muted : colors.card,
              color: colors.foreground,
              fontFamily: fonts.sans,
              fontSize: 15,
            },
            style,
          ]}
          {...props}
        />
        {isPassword && (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            accessibilityState={{ selected: revealed }}
            hitSlop={4}
            style={{ position: "absolute", right: 0, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Feather name={revealed ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Two-option segmented control (e.g. Vinyl / CD). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: colors.muted,
        borderRadius: radius.md,
        padding: 3,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              backgroundColor: active ? colors.card : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 12,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: active ? colors.foreground : colors.mutedForeground,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small coloured status label with a dot. */
export function StatusPill({ label, color }: { label: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        alignSelf: "flex-start",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.sm,
        backgroundColor: colors.muted,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6, color: colors.foreground }}>
        {label}
      </Text>
    </View>
  );
}

/** Selectable filter chip (tag filter row). */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        height: 32,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        justifyContent: "center",
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.input,
        backgroundColor: selected ? colors.primary : colors.card,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 12,
          color: selected ? colors.primaryForeground : colors.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export type TabKey = "capture" | "catalog";

/** Bottom tab bar: mono uppercase labels, Harvest Orange active state. */
export function TabBar({
  active,
  onChange,
  bottomInset,
  badges,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
  bottomInset: number;
  badges?: Partial<Record<TabKey, number>>;
}) {
  const { colors } = useTheme();
  const tabs: { key: TabKey; label: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
    { key: "capture", label: "Capture", icon: "camera" },
    { key: "catalog", label: "Catalog", icon: "disc" },
  ];
  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        backgroundColor: colors.background,
        paddingBottom: Math.max(bottomInset, 8),
      }}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        const badge = badges?.[t.key];
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${t.label}, ${badge} waiting to upload` : t.label}
            onPress={() => onChange(t.key)}
            style={{ flex: 1, alignItems: "center", paddingTop: 10, gap: 4 }}
          >
            {/* Active indicator: an orange bar along the top edge, like the web nav underline. */}
            <View
              style={{
                position: "absolute",
                top: 0,
                height: 2,
                width: 40,
                backgroundColor: on ? colors.primary : "transparent",
              }}
            />
            <View>
              <Feather name={t.icon} size={20} color={on ? colors.foreground : colors.mutedForeground} />
              {badge ? (
                <View
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -10,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    paddingHorizontal: 4,
                    backgroundColor: colors.primary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontFamily: fonts.monoSemiBold, fontSize: 10, color: colors.primaryForeground }}>
                    {badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: on ? colors.foreground : colors.mutedForeground,
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Key/value row for detail screens. */
export function DetailRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <Text variant="label">{label}</Text>
      <Text
        variant={mono ? "mono" : "body"}
        style={{ flexShrink: 1, textAlign: "right", color: value ? colors.foreground : colors.mutedForeground }}
      >
        {value || "—"}
      </Text>
    </View>
  );
}
