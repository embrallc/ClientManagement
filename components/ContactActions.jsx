import { MaterialCommunityIcons } from "@expo/vector-icons";
import { theme } from "@theme";
import { useRef, useState } from "react";
import { Alert, StyleSheet, TouchableOpacity, View } from "react-native";
import { logError } from "../db/logs";
import { useDebouncedPress } from "../hooks/useDebouncedPress";
import { useSmsStore } from "../stores/useSmsStore";
import { openCall, openEmail, openSmsComposer } from "../utils/contact";
import SmsBubble from "./SmsBubble";

// Client-contact icon row (SMS / Call / Email) for a single inspection. Pulled
// out of InspectionCard so the same follow-up actions live on completed,
// cancelled, deleted, and payment-activity cards — letting the user reach a
// client in any state without reopening the inspection.
//
// Props:
//   inspection — needs Phone, Email, ReportRecipients (for the mail recipient
//     list) and InspectionSk (logging only). A minimal object is fine.
//   iconSize   — override the icon size (defaults to theme icon size `m`).
//   style      — extra style for the row container.
export default function ContactActions({ inspection, iconSize, style }) {
  const templates = useSmsStore((s) => s.templates);
  const [smsOpen, setSmsOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const smsRef = useRef(null);

  const phone = inspection?.Phone;
  const email = inspection?.Email;
  const sk = inspection?.InspectionSk;
  const size = iconSize ?? theme?.layout?.iconSize?.m;

  const handleSmsSend = async (body) => {
    try {
      await openSmsComposer(phone, body);
    } catch (e) {
      logError(e, `ContactActions.handleSmsSend sk=${sk}`);
    }
  };

  const handleSmsPress = useDebouncedPress(() => {
    if (!phone) {
      Alert.alert("No phone number on this inspection.");
      return;
    }
    // No templates → skip the picker bubble and open a blank message straight away.
    if (templates.length === 0) {
      handleSmsSend("");
      return;
    }
    smsRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, w, h });
      setSmsOpen(true);
    });
  });

  const handleCall = useDebouncedPress(async () => {
    try {
      await openCall(phone);
    } catch (e) {
      logError(e, `ContactActions.handleCall sk=${sk}`);
    }
  });

  const handleEmail = useDebouncedPress(async () => {
    try {
      await openEmail(inspection);
    } catch (e) {
      logError(e, `ContactActions.handleEmail sk=${sk}`);
    }
  });

  // Nothing to contact → render nothing (keeps cards clean when a row has no
  // phone or email).
  if (!phone && !email) return null;

  return (
    <View style={[styles.row, style]}>
      {!!phone && (
        <TouchableOpacity
          ref={smsRef}
          onPress={handleSmsPress}
          hitSlop={theme?.layout?.hitSlop?.medium}
          style={styles.btn}
        >
          <MaterialCommunityIcons
            name="message-text-outline"
            size={size}
            color={theme?.colors?.primary}
          />
        </TouchableOpacity>
      )}

      {!!phone && (
        <TouchableOpacity
          onPress={handleCall}
          hitSlop={theme?.layout?.hitSlop?.medium}
          style={styles.btn}
        >
          <MaterialCommunityIcons
            name="phone-outline"
            size={size}
            color={theme?.colors?.primary}
          />
        </TouchableOpacity>
      )}

      {!!email && (
        <TouchableOpacity
          onPress={handleEmail}
          hitSlop={theme?.layout?.hitSlop?.medium}
          style={styles.btn}
        >
          <MaterialCommunityIcons
            name="email-outline"
            size={size}
            color={theme?.colors?.primary}
          />
        </TouchableOpacity>
      )}

      {smsOpen && anchor && (
        <SmsBubble
          anchor={anchor}
          templates={templates}
          onClose={() => setSmsOpen(false)}
          onSelect={handleSmsSend}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme?.spacing?.m,
  },
  btn: {
    padding: theme?.spacing?.xs,
  },
});
