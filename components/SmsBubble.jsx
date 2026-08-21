import { MaterialCommunityIcons } from "@expo/vector-icons";
import { theme } from "@theme";
import { useEffect } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// Anchored popover of SMS quick-templates (plus an always-present "Blank Message").
// The caller measures the tapped button and passes its window rect as `anchor`;
// the bubble positions itself just above it. `onSelect(body)` receives the chosen
// template body ("" = blank). Extracted from InspectionCard so any card's SMS
// button can reuse it.

const TAIL_SIZE = 13;
const BUBBLE_MAX_WIDTH = 268;
const TAIL_FROM_LEFT = 22;

export default function SmsBubble({ anchor, templates, onClose, onSelect }) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: 210,
      easing: Easing.out(Easing.cubic),
    });
  }, []);

  function handleClose() {
    progress.value = withTiming(0, { duration: 130 }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }

  // Dismiss the bubble, then hand the chosen body up (null/"" = blank message).
  function pick(body) {
    progress.value = withTiming(0, { duration: 130 }, (finished) => {
      if (finished) {
        runOnJS(onClose)();
        runOnJS(onSelect)(body);
      }
    });
  }

  const bubbleAnim = useAnimatedStyle(() => {
    const s = progress.value;
    return {
      opacity: s,
      transform: [
        { scale: interpolate(s, [0, 1], [0.12, 1]) },
        { translateY: interpolate(s, [0, 1], [16, 0]) },
      ],
    };
  });

  // Position bubble above the tapped button
  const buttonCenterX = anchor.x + anchor.w / 2;
  const bubbleLeft = Math.max(
    8,
    Math.min(
      buttonCenterX - TAIL_FROM_LEFT - TAIL_SIZE,
      windowWidth - BUBBLE_MAX_WIDTH - 8,
    ),
  );
  // bottom of bubble sits just above the button with a gap for the tail
  const bubbleBottom = windowHeight - anchor.y + TAIL_SIZE + 2;

  // Where the tail triangle sits within the bubble
  const tailLeft = Math.max(10, buttonCenterX - bubbleLeft - TAIL_SIZE);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop */}
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={[StyleSheet.absoluteFill, bubbleStyles.backdrop]} />
        </TouchableWithoutFeedback>

        {/* Bubble */}
        <Animated.View
          style={[
            bubbleStyles.bubble,
            { bottom: bubbleBottom, left: bubbleLeft },
            bubbleAnim,
          ]}
        >
          <View style={bubbleStyles.pillsRow}>
            {/* Always-present blank option: opens SMS with only the number. */}
            <TouchableOpacity
              style={[bubbleStyles.pill, bubbleStyles.blankPill]}
              activeOpacity={0.7}
              onPress={() => pick("")}
            >
              <MaterialCommunityIcons
                name="message-plus-outline"
                size={15}
                color={theme.colors.textFine}
                style={bubbleStyles.blankPillIcon}
              />
              <Text
                style={[bubbleStyles.pillText, bubbleStyles.blankPillText]}
                numberOfLines={1}
              >
                Blank Message
              </Text>
            </TouchableOpacity>

            {templates.map((t) => (
              <TouchableOpacity
                key={t.SmsTemplateSk}
                style={bubbleStyles.pill}
                activeOpacity={0.7}
                onPress={() => pick(t.Body || "")}
              >
                <Text style={bubbleStyles.pillText} numberOfLines={1}>
                  {t.Name || "Unnamed"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tail triangle */}
          <View style={[bubbleStyles.tail, { left: tailLeft }]} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const bubbleStyles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  bubble: {
    position: "absolute",
    maxWidth: BUBBLE_MAX_WIDTH,
    minWidth: 160,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.layout.borderRadius.l,
    paddingHorizontal: theme.spacing.m,
    paddingTop: theme.spacing.m,
    paddingBottom: theme.spacing.s,
    ...theme.shadows.medium,
    // ensure shadow renders above backdrop
    elevation: 8,
  },
  tail: {
    position: "absolute",
    bottom: -TAIL_SIZE,
    width: 0,
    height: 0,
    borderLeftWidth: TAIL_SIZE,
    borderRightWidth: TAIL_SIZE,
    borderTopWidth: TAIL_SIZE,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: theme.colors.cardBackground,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.s,
    paddingBottom: theme.spacing.xs,
  },
  pill: {
    backgroundColor: theme.colors.primaryGhost,
    borderRadius: theme.layout.borderRadius.full,
    paddingHorizontal: theme.spacing.m,
    paddingVertical: 6,
    borderWidth: theme.layout.borderWidth.base,
    borderColor: "rgba(92,92,232,0.18)",
  },
  pillText: {
    ...theme.typography.label,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  // (empty-state styles removed — the bubble always shows at least Blank Message)
  blankPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.mainBackground,
    borderColor: "rgba(0,0,0,0.14)",
    borderStyle: "dashed",
  },
  blankPillIcon: {
    marginRight: 5,
  },
  blankPillText: {
    color: theme.colors.textFine,
  },
});
