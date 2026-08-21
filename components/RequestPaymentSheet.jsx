import { MaterialCommunityIcons } from "@expo/vector-icons";
import { theme } from "@theme";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { logError } from "../db/logs";
import {
  emailInvoiceToClient,
  requestPayment,
  shareCheckoutLink,
} from "../utils/payments";

// Reusable "Request Payment" sheet: enter an amount → create (or reuse) a Stripe
// Checkout link → success state with the link (selectable, long-press to copy)
// and a Share button. Used from the active InspectionCard and the Archive.
//
// Props: visible, onClose(outcome), inspectionSk, clientName?, userProfile?,
//        onSuccess?, gatedComplete?, recipients?
//
// gatedComplete: when true the sheet is gating an inspection's completion (opened
// by "auto-send invoice on complete" because no invoice exists yet). It adds a
// "Complete without invoice" escape, and onClose is called with an outcome —
// 'invoiced' | 'cancelled' | 'skipped' — so the caller knows whether to finish
// the completion. Non-gated callers pass onClose={() => ...} and ignore the arg.
//
// recipients: invoice-channel addresses (collectInvoiceRecipients) — the list the
// "Email" action delivers the link to, shown in its confirmation.
export default function RequestPaymentSheet({
  visible,
  onClose,
  inspectionSk,
  clientName,
  userProfile,
  onSuccess,
  gatedComplete = false,
  recipients = [],
}) {
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("input"); // "input" | "success"
  const [link, setLink] = useState(null);
  const [autoSent, setAutoSent] = useState(false);
  const [emailing, setEmailing] = useState(false);
  // Inline result of the Email action ({ kind:'success'|'error', text }). Inline
  // rather than a TopBanner because the banner would sit BEHIND this native modal.
  const [emailStatus, setEmailStatus] = useState(null);

  function reset() {
    setAmountText("");
    setBusy(false);
    setPhase("input");
    setLink(null);
    setAutoSent(false);
    setEmailing(false);
    setEmailStatus(null);
  }

  // Email the invoice link to the invoice-channel recipients via Resend (one
  // email to all). Confirms the address list first (mirrors the report's Send).
  function handleEmailInvoice() {
    if (emailing) return;
    if (!recipients || recipients.length === 0) {
      setEmailStatus({
        kind: "error",
        text: "No invoice email addresses are set for this inspection.",
      });
      return;
    }
    Alert.alert(
      "Email invoice",
      `Email the invoice to:\n\n${recipients.join("\n")}`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Email", onPress: doEmailInvoice },
      ],
    );
  }

  async function doEmailInvoice() {
    setEmailing(true);
    setEmailStatus(null);
    try {
      const { recipientCount } = await emailInvoiceToClient(inspectionSk);
      setEmailStatus({
        kind: "success",
        text: `Invoice emailed to ${recipientCount} recipient${
          recipientCount === 1 ? "" : "s"
        }.`,
      });
    } catch (e) {
      logError(e, `RequestPaymentSheet.emailInvoice sk=${inspectionSk}`);
      setEmailStatus({
        kind: "error",
        text: e?.presentable ? e.message : "Couldn't send the invoice.",
      });
    } finally {
      setEmailing(false);
    }
  }

  // Infer the outcome from the phase when the caller doesn't force one: reaching
  // the success phase means an invoice was created ('invoiced'); otherwise the
  // user backed out ('cancelled'). The gated "Complete without invoice" button
  // passes 'skipped' explicitly.
  function close(outcome) {
    if (busy) return;
    const o =
      typeof outcome === "string"
        ? outcome
        : phase === "success"
          ? "invoiced"
          : "cancelled";
    reset();
    onClose?.(o);
  }

  async function submit() {
    if (busy) return;
    const dollars = parseFloat(String(amountText).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars) || dollars < 0.5) {
      Alert.alert("Enter an amount", "Please enter an amount of at least $0.50.");
      return;
    }
    const cents = Math.round(dollars * 100);
    setBusy(true);
    try {
      const data = await requestPayment(inspectionSk, cents);
      setLink(data.checkoutUrl);
      setAutoSent(!!data.autoSent);
      setPhase("success");
      onSuccess?.(data);
    } catch (e) {
      logError(e, `RequestPaymentSheet.submit sk=${inspectionSk}`);
      if (e?.code === "onboarding_incomplete") {
        Alert.alert(
          "Payments not set up",
          userProfile === "owner"
            ? "Finish connecting your Stripe account in Settings → Payments before billing clients."
            : "Your account owner needs to finish payment setup before invoices can be sent.",
        );
      } else if (e?.code === "invalid_amount") {
        Alert.alert("Enter an amount", "Please enter an amount of at least $0.50.");
      } else {
        Alert.alert("Couldn't create payment", e?.message || "Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => close()}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <TouchableWithoutFeedback onPress={() => close()}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View style={styles.sheet}>
          {phase === "input" ? (
            <>
              <Text style={styles.title}>Request Payment</Text>
              {clientName ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {clientName}
                </Text>
              ) : null}
              <View style={styles.inputRow}>
                <Text style={styles.currency}>$</Text>
                <TextInput
                  style={styles.input}
                  value={amountText}
                  onChangeText={setAmountText}
                  placeholder="0.00"
                  placeholderTextColor={theme.colors.textFine}
                  keyboardType="decimal-pad"
                  autoFocus
                  editable={!busy}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />
              </View>
              <Text style={styles.hint}>
                We'll create a secure Stripe link to share with your client.
              </Text>
              <View style={styles.buttons}>
                <TouchableOpacity
                  style={[styles.btn, styles.cancel]}
                  onPress={() => close()}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.confirm, busy && styles.btnDisabled]}
                  onPress={submit}
                  disabled={busy}
                  activeOpacity={0.85}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.confirmTxt}>Create Link</Text>
                  )}
                </TouchableOpacity>
              </View>
              {gatedComplete && (
                <TouchableOpacity
                  style={styles.skipBtn}
                  onPress={() => close("skipped")}
                  disabled={busy}
                  activeOpacity={0.7}
                >
                  <Text style={styles.skipTxt}>Complete without invoice</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              <View style={styles.successIconWrap}>
                <MaterialCommunityIcons
                  name="check-circle"
                  size={48}
                  color={theme.colors.success}
                />
              </View>
              <Text style={styles.title}>
                {autoSent ? "Invoice sent" : "Payment link ready"}
              </Text>
              <Text style={styles.hint}>
                {autoSent
                  ? "We emailed the payment link to your client. You can also share it below — it's saved under Settings → Payment Activity."
                  : "Share it with your client, or long-press the link to copy. It's also saved under Settings → Payment Activity."}
              </Text>
              <View style={styles.linkBox}>
                <Text selectable style={styles.linkText} numberOfLines={3}>
                  {link}
                </Text>
              </View>

              {/* Email — the recommended, cross-platform delivery (like the
                  report's Send): straight to the client's invoice recipients via
                  Resend, no device mail app. */}
              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.confirm,
                  styles.emailBtn,
                  emailing && styles.btnDisabled,
                ]}
                onPress={handleEmailInvoice}
                disabled={emailing}
                activeOpacity={0.85}
              >
                {emailing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name="email-outline"
                      size={18}
                      color="#fff"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.confirmTxt}>Email</Text>
                  </>
                )}
              </TouchableOpacity>

              {emailStatus ? (
                <View style={styles.emailStatusRow}>
                  <MaterialCommunityIcons
                    name={
                      emailStatus.kind === "success"
                        ? "check-circle"
                        : "alert-circle-outline"
                    }
                    size={16}
                    color={
                      emailStatus.kind === "success"
                        ? theme.colors.success
                        : theme.colors.error
                    }
                  />
                  <Text
                    style={[
                      styles.emailStatusTxt,
                      {
                        color:
                          emailStatus.kind === "success"
                            ? theme.colors.success
                            : theme.colors.error,
                      },
                    ]}
                  >
                    {emailStatus.text}
                  </Text>
                </View>
              ) : null}

              <View style={styles.buttons}>
                <TouchableOpacity
                  style={[styles.btn, styles.cancel]}
                  onPress={() => close()}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelTxt}>Done</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.confirm]}
                  onPress={() => shareCheckoutLink(link, clientName)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons
                    name="share-variant"
                    size={18}
                    color="#fff"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.confirmTxt}>Share</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: theme.spacing.l,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.layout.borderRadius.l,
    padding: theme.spacing.l,
    ...theme.shadows.medium,
  },
  title: { ...theme.typography.h4, textAlign: "center" },
  subtitle: {
    ...theme.typography.label,
    color: theme.colors.textSubtle,
    textAlign: "center",
    marginTop: 2,
    marginBottom: theme.spacing.m,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.input,
    borderRadius: theme.layout.borderRadius.m,
    paddingHorizontal: theme.spacing.m,
    marginTop: theme.spacing.s,
  },
  currency: {
    ...theme.typography.h3,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
  },
  input: {
    flex: 1,
    ...theme.typography.h3,
    color: theme.colors.text,
    paddingVertical: theme.spacing.m,
  },
  hint: {
    ...theme.typography.caption,
    color: theme.colors.textSubtle,
    marginTop: theme.spacing.s,
    textAlign: "center",
    lineHeight: 16,
  },
  successIconWrap: { alignItems: "center", marginBottom: theme.spacing.s },
  linkBox: {
    backgroundColor: theme.colors.input,
    borderRadius: theme.layout.borderRadius.m,
    padding: theme.spacing.m,
    marginTop: theme.spacing.m,
  },
  linkText: { ...theme.typography.label, color: theme.colors.primary },
  buttons: {
    flexDirection: "row",
    gap: theme.spacing.s,
    marginTop: theme.spacing.l,
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.layout.borderRadius.m,
    paddingVertical: theme.spacing.m,
    minHeight: 48,
  },
  cancel: { backgroundColor: theme.colors.input },
  cancelTxt: { ...theme.typography.bodyBold, color: theme.colors.text },
  skipBtn: {
    alignItems: "center",
    paddingVertical: theme.spacing.s,
    marginTop: theme.spacing.s,
  },
  skipTxt: {
    ...theme.typography.label,
    color: theme.colors.textSubtle,
    fontWeight: "600",
  },
  confirm: { backgroundColor: theme.colors.primary, ...theme.shadows.light },
  confirmTxt: { ...theme.typography.bodyBold, color: "#fff" },
  btnDisabled: { opacity: theme.layout.opacity.disabled },
  emailBtn: { marginTop: theme.spacing.m },
  emailStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: theme.spacing.s,
  },
  emailStatusTxt: {
    ...theme.typography.label,
    fontWeight: "600",
    flex: 1,
  },
});
