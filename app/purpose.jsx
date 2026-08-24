import { MaterialCommunityIcons } from "@expo/vector-icons";
import { theme } from "@theme";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// "Our Purpose" — the brand's giving pledge, surfaced in-app so every user knows
// that using Zanbi helps kids in need. Copy is deliberately CAUSE-AREA based (no
// named charities) and pledges a share of PROFITS at the company level, not a cut
// of any purchase — see the giving-pledge notes for the legal reasoning.
const CAUSES = [
  {
    icon: "heart-pulse",
    title: "Children's health",
    body: "Support for kids facing medical challenges and complex health needs.",
  },
  {
    icon: "gift-outline",
    title: "A brighter holiday",
    body: "Gifts and joy for children in families going through hard times.",
  },
  {
    icon: "school-outline",
    title: "Learning for every child",
    body: "Help for kids with special education needs to learn and thrive.",
  },
];

export default function PurposeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* Nav bar */}
      <View style={styles.navbar}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={theme?.layout?.hitSlop?.medium}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={theme?.layout?.iconSize?.l}
            color={theme?.colors?.icon}
          />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Our Purpose</Text>
        <View style={{ width: theme?.layout?.iconSize?.l }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons
              name="hand-heart"
              size={34}
              color={theme?.colors?.primary}
            />
          </View>
          <Text style={styles.motto}>A Business with a Real Purpose.</Text>
          <Text style={styles.heroSub}>
            When you use Zanbi, you're helping kids in need.
          </Text>
        </View>

        {/* Pledge */}
        <View style={styles.card}>
          <Text style={styles.pledgeNumber}>40%</Text>
          <Text style={styles.pledgeText}>
            of our profits go to organizations supporting children's{" "}
            <Text style={styles.pledgeStrong}>health</Text>,{" "}
            <Text style={styles.pledgeStrong}>education</Text>, and{" "}
            <Text style={styles.pledgeStrong}>well-being</Text>.
          </Text>

          {/* 60 / 40 split */}
          <View style={styles.splitBar}>
            <View style={styles.splitGiven} />
            <View style={styles.splitKept} />
          </View>
          <View style={styles.splitLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.dotGiven]} />
              <Text style={styles.legendText}>40% to children's causes</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.dotKept]} />
              <Text style={styles.legendText}>60% to build Zanbi</Text>
            </View>
          </View>
        </View>

        {/* Where it goes */}
        <Text style={styles.sectionLabel}>WHERE IT GOES</Text>
        {CAUSES.map((c) => (
          <View key={c.title} style={styles.causeCard}>
            <View style={styles.causeIcon}>
              <MaterialCommunityIcons
                name={c.icon}
                size={22}
                color={theme?.colors?.primary}
              />
            </View>
            <View style={styles.causeText}>
              <Text style={styles.causeTitle}>{c.title}</Text>
              <Text style={styles.causeBody}>{c.body}</Text>
            </View>
          </View>
        ))}

        {/* Closing */}
        <View style={styles.closingCard}>
          <Text style={styles.closingText}>
            We don't do this for recognition — we do it because it's right. We
            keep 60% of our profits to build and run Zanbi, and give the other
            40% to help children. By choosing Zanbi, you help make it possible.
          </Text>
        </View>

        <Text style={styles.foot}>Zanbi · A product of Embra LLC</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme?.colors?.mainBackground,
  },
  navbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme?.spacing?.m,
    paddingVertical: theme?.spacing?.m,
    backgroundColor: theme?.colors?.cardBackground,
    borderBottomWidth: theme?.layout?.borderWidth?.thin,
    borderBottomColor: theme?.colors?.input,
    ...theme?.shadows?.light,
  },
  navTitle: {
    ...theme?.typography?.h4,
  },
  content: {
    padding: theme?.spacing?.m,
    paddingBottom: theme?.spacing?.xxl,
  },
  hero: {
    alignItems: "center",
    paddingVertical: theme?.spacing?.l,
    paddingHorizontal: theme?.spacing?.m,
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme?.colors?.primaryGhost,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme?.spacing?.m,
  },
  motto: {
    ...theme?.typography?.h2,
    textAlign: "center",
  },
  heroSub: {
    ...theme?.typography?.body,
    color: theme?.colors?.textSubtle,
    textAlign: "center",
    marginTop: theme?.spacing?.s,
  },
  card: {
    backgroundColor: theme?.colors?.cardBackground,
    borderRadius: theme?.layout?.borderRadius?.m,
    padding: theme?.spacing?.l,
    marginBottom: theme?.spacing?.s,
    ...theme?.shadows?.light,
  },
  pledgeNumber: {
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1,
    color: theme?.colors?.primary,
  },
  pledgeText: {
    ...theme?.typography?.body,
    fontSize: 16,
    lineHeight: 24,
    marginTop: theme?.spacing?.xs,
  },
  pledgeStrong: {
    fontWeight: "700",
    color: theme?.colors?.text,
  },
  splitBar: {
    flexDirection: "row",
    height: 14,
    borderRadius: theme?.layout?.borderRadius?.full,
    overflow: "hidden",
    marginTop: theme?.spacing?.m,
  },
  splitGiven: {
    flex: 40,
    backgroundColor: theme?.colors?.primary,
  },
  splitKept: {
    flex: 60,
    backgroundColor: theme?.colors?.input,
  },
  splitLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme?.spacing?.m,
    marginTop: theme?.spacing?.s,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGiven: {
    backgroundColor: theme?.colors?.primary,
  },
  dotKept: {
    backgroundColor: theme?.colors?.input,
  },
  legendText: {
    ...theme?.typography?.caption,
    color: theme?.colors?.textSubtle,
  },
  sectionLabel: {
    ...theme?.typography?.overline,
    marginTop: theme?.spacing?.l,
    marginBottom: theme?.spacing?.s,
  },
  causeCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme?.colors?.cardBackground,
    borderRadius: theme?.layout?.borderRadius?.m,
    padding: theme?.spacing?.m,
    marginBottom: theme?.spacing?.s,
    ...theme?.shadows?.light,
  },
  causeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme?.colors?.primaryGhost,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme?.spacing?.m,
  },
  causeText: {
    flex: 1,
  },
  causeTitle: {
    ...theme?.typography?.bodyBold,
  },
  causeBody: {
    ...theme?.typography?.label,
    marginTop: 2,
  },
  closingCard: {
    backgroundColor: theme?.colors?.primaryGhost,
    borderRadius: theme?.layout?.borderRadius?.m,
    padding: theme?.spacing?.l,
    marginTop: theme?.spacing?.s,
  },
  closingText: {
    ...theme?.typography?.body,
    lineHeight: 23,
  },
  foot: {
    ...theme?.typography?.caption,
    color: theme?.colors?.textFine,
    textAlign: "center",
    marginTop: theme?.spacing?.l,
  },
});
