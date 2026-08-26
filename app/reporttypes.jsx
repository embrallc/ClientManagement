import { MaterialCommunityIcons } from "@expo/vector-icons";
import { theme } from "@theme";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logError } from "../db/logs";
import { getOrgReportTypes, setOrgReportTypes } from "../db/organizations";
import { isOnline } from "../utils/connectivity";
import { useSettingsStore } from "../stores/useSettingsStore";

// Owner-only "which report types this org produces" settings. Two masters — PDF
// and interactive Online — each with a "default for new inspections" switch that
// seeds the per-inspection toggle in Add/Edit. These are org-level columns
// (synced only in the cloud, like the payment policy toggles), read/written the
// same way the Automatic Document Send screen reads the org's toggles. The report
// worker + client-send functions read them server-side to decide what to build
// and email; turning both off for an inspection sends the client a short
// "your inspection is complete" note instead of a report.
export default function ReportTypesScreen() {
  const router = useRouter();
  const orgSk = useSettingsStore((s) => s.orgSk);
  const userProfile = useSettingsStore((s) => s.userProfile);

  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    // Org-level config lives only in Supabase — there's no local copy. Offline we
    // can't know the real values, so don't render the toggles (defaulting to off
    // reads as "never turned on" when they may be on). Show an offline notice.
    if (!isOnline()) {
      setOffline(true);
      setCfg(null);
      setLoading(false);
      return;
    }
    try {
      const c = await getOrgReportTypes(orgSk);
      setCfg(c);
      setOffline(false);
    } catch (e) {
      logError(e, "ReportTypes.reload");
      setOffline(true);
      setCfg(null);
    } finally {
      setLoading(false);
    }
  }, [orgSk]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function toggle(key, val) {
    const prev = cfg;
    setCfg((c) => ({ ...c, [key]: val }));
    try {
      await setOrgReportTypes(orgSk, { [key]: val });
    } catch (e) {
      logError(e, `ReportTypes.toggle ${key}`);
      setCfg(prev);
      Alert.alert("Couldn't save", "That setting didn't save. Please try again.");
    }
  }

  const pdfOn = !!cfg?.report_pdf_enabled;
  const onlineOn = !!cfg?.report_online_enabled;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.navbar}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={theme.layout.hitSlop.medium}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={theme.layout.iconSize.l}
            color={theme.colors.icon}
          />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Report Types</Text>
        <View style={{ width: theme.layout.iconSize.l }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {userProfile !== "owner" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Owner only</Text>
            <Text style={styles.cardBody}>
              Only the organization owner can change report types.
            </Text>
          </View>
        ) : loading ? (
          <ActivityIndicator
            size="large"
            color={theme.colors.primary}
            style={{ marginTop: theme.spacing.xl }}
          />
        ) : offline ? (
          <View style={styles.card}>
            <View style={styles.offlineHead}>
              <MaterialCommunityIcons
                name="wifi-off"
                size={20}
                color={theme.colors.textFine}
              />
              <Text style={styles.cardTitle}>Can't load these settings</Text>
            </View>
            <Text style={styles.cardBody}>
              Report types are stored with your organization, so they need an
              internet connection to load. Reconnect and tap Retry — your current
              settings are safe and unchanged.
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={reload}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name="refresh"
                size={16}
                color={theme.colors.primary}
              />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.intro}>
              Choose which report types your business offers. Each type you turn on
              gets a default for new inspections — you can still switch it per
              inspection when you add or edit one.
            </Text>

            {/* PDF */}
            <SettingRow
              label="PDF report"
              description="A downloadable PDF report, emailed to the client."
              value={pdfOn}
              onValueChange={(v) => toggle("report_pdf_enabled", v)}
            />
            {pdfOn ? (
              <SettingRow
                nested
                label="On by default for new inspections"
                value={!!cfg?.report_pdf_default}
                onValueChange={(v) => toggle("report_pdf_default", v)}
              />
            ) : null}

            {/* Online */}
            <View style={{ height: theme.spacing.s }} />
            <SettingRow
              label="Interactive online report"
              description="A mobile-friendly web report the client opens by link (private, behind a quick email code)."
              value={onlineOn}
              onValueChange={(v) => toggle("report_online_enabled", v)}
            />
            {onlineOn ? (
              <SettingRow
                nested
                label="On by default for new inspections"
                value={!!cfg?.report_online_default}
                onValueChange={(v) => toggle("report_online_default", v)}
              />
            ) : null}

            {!pdfOn && !onlineOn ? (
              <View style={styles.noteCard}>
                <MaterialCommunityIcons
                  name="information-outline"
                  size={18}
                  color={theme.colors.primary}
                />
                <Text style={styles.noteText}>
                  With both types off, completing an inspection just emails the
                  client a short "your inspection is complete" note — no report.
                </Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({ label, description, value, onValueChange, nested }) {
  return (
    <View style={[styles.row, nested && styles.rowNested]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, nested && styles.rowLabelNested]}>
          {label}
        </Text>
        {description ? (
          <Text style={styles.rowDescription}>{description}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.input, true: theme.colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.mainBackground },
  navbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.m,
    paddingVertical: theme.spacing.m,
    backgroundColor: theme.colors.cardBackground,
    borderBottomWidth: theme.layout.borderWidth.thin,
    borderBottomColor: theme.colors.input,
    ...theme.shadows.light,
  },
  navTitle: { ...theme.typography.h4 },
  content: { padding: theme.spacing.m, paddingBottom: theme.spacing.xxl },
  intro: {
    ...theme.typography.label,
    color: theme.colors.textSubtle,
    marginBottom: theme.spacing.m,
    lineHeight: 19,
  },
  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.layout.borderRadius.m,
    padding: theme.spacing.m,
    marginBottom: theme.spacing.m,
    ...theme.shadows.light,
  },
  cardTitle: { ...theme.typography.bodyBold },
  cardBody: {
    ...theme.typography.label,
    color: theme.colors.textSubtle,
    marginTop: 2,
    lineHeight: 19,
  },
  offlineHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.s,
    marginBottom: theme.spacing.xs,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    marginTop: theme.spacing.m,
    borderWidth: theme.layout.borderWidth.base,
    borderColor: theme.colors.primary,
    borderRadius: theme.layout.borderRadius.full,
    paddingHorizontal: theme.spacing.m,
    paddingVertical: 6,
  },
  retryText: {
    ...theme.typography.label,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.cardBackground,
    paddingHorizontal: theme.spacing.m,
    paddingVertical: theme.spacing.m,
    borderRadius: theme.layout.borderRadius.m,
    marginBottom: theme.spacing.s,
    ...theme.shadows.light,
  },
  // Nested "default" row — inset + lighter so it reads as a child of the master
  // toggle above it.
  rowNested: {
    marginLeft: theme.spacing.l,
    marginTop: -theme.spacing.xs,
    backgroundColor: theme.colors.mainBackground,
    borderWidth: theme.layout.borderWidth.base,
    borderColor: theme.colors.input,
    // Flatten the light shadow inherited from `row` so the child reads as inset.
    shadowOpacity: 0,
    elevation: 0,
  },
  rowText: { flex: 1, marginRight: theme.spacing.m },
  rowLabel: { ...theme.typography.bodyBold },
  rowLabelNested: { ...theme.typography.body },
  rowDescription: {
    ...theme.typography.label,
    color: theme.colors.textSubtle,
    marginTop: 2,
    lineHeight: 18,
  },
  noteCard: {
    flexDirection: "row",
    gap: theme.spacing.s,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.layout.borderRadius.m,
    padding: theme.spacing.m,
    marginTop: theme.spacing.s,
    ...theme.shadows.light,
  },
  noteText: {
    ...theme.typography.label,
    color: theme.colors.textSubtle,
    flex: 1,
    lineHeight: 18,
  },
});
