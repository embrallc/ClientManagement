# Decommissioned: in-app billing-owner **transfer** (2026-07-24)

**Status:** DECOMMISSIONED, preserved for future revival. Not wired into the app.

## Why it was removed
Zanbi uses a **single-payer-per-org** model (memory `project_billing_owner`): one designated
billing owner's Apple/Play account funds the whole org. The Manage Users screen used to let an
owner **transfer** that designation to another owner/admin via the `$` badge.

The problem: transferring the *designation* (`organizations.billing_owner_id`) does **not** move the
actual Apple subscription — Apple subs are bound to the payer's Apple ID and can't be reassigned or
cancelled by us. So a transfer created a confusing decoupled state (old payer keeps being charged
until they personally cancel in iOS Settings; the org runs on the old sub until the new owner
subscribes; brief double-billing). For a launch where virtually every org is a solo owner, this was
complexity with no upside.

**Decision (2026-07-24):** lock billing to the **original owner** (the account that first subscribed;
auto-falls-back to the next-oldest owner only if that account is deleted, via `ON DELETE SET NULL` +
the `subscription-status` re-default). Non-billing owners get **read-only** visibility of pending
approvals so they can nudge the payer. Revisit real transfer / multi-payer **only if we see group
signups that need it** — see `V2-FEATURES.md`.

## What's still live (the server half — intentionally kept)
- **RPC `public.set_billing_owner(uuid)`** — still deployed (migration `20260703000000_billing_owner.sql`),
  still `GRANT EXECUTE ... TO authenticated`. It's just no longer *called* by any client. Reviving the
  feature = re-wire the client below; the server contract already exists.
- **`organizations.billing_owner_id`** column + the auto-default/fallback in `subscription-status`.
- The **single-payer guard** in `_shared/rcSync.ts` `writeOrgBilling` already tolerates a re-designation
  (it allows a write when the payer == `billing_owner_id`), so transfer can be re-enabled without
  touching the guard.

## Removed client code (from `app/manageusers.jsx`) — paste-back starting point

```jsx
// ── imports/state ──
import { useSubscriptionStore } from "../stores/useSubscriptionStore";
const refreshSubscription = useSubscriptionStore((s) => s.refreshStatus);

// Who may transfer the $ designation: an owner, or the current holder.
const canTransferBilling =
  userProfile === "owner" || (!!billingOwnerId && userSk === billingOwnerId);

// ── transferBilling: assign/transfer the $ designation via the RPC ──
function transferBilling(target) {
  if (!isOnline()) {
    Alert.alert(
      "You're offline",
      "Connect to the internet to change the billing owner.",
    );
    return;
  }
  const name = displayName(target);
  const hasCurrent = !!billingOwnerId;
  Alert.alert(
    hasCurrent ? "Transfer billing control?" : "Set billing owner?",
    `You're ${hasCurrent ? "transferring" : "assigning"} the only org rights to approve new users and subscription upgrades to ${name}. After this, only ${name} can add seats or change the plan.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: hasCurrent ? "Transfer" : "Assign",
        onPress: async () => {
          setUpdating((m) => ({ ...m, [target.id]: true }));
          try {
            const { error } = await supabase.rpc("set_billing_owner", {
              p_target_user_id: target.id,
            });
            if (error) throw error;
            setBillingOwnerId(target.id);
            // Refresh the shared status so Settings/Approvals re-gate for the
            // new (and former) billing owner right away.
            refreshSubscription?.();
          } catch (e) {
            logError(
              e,
              `ManageUsersScreen.transferBilling target=${target.id}`,
            );
            Alert.alert(
              "Couldn't transfer",
              e?.message ?? "The server rejected this change.",
            );
          } finally {
            setUpdating((m) => {
              const next = { ...m };
              delete next[target.id];
              return next;
            });
          }
        },
      },
    ],
  );
}

// ── onBadgePress: explain state / start a transfer ──
function onBadgePress(item) {
  const isBillingOwner = item.id === billingOwnerId;
  const eligible =
    item.user_profile === "owner" || item.user_profile === "admin";
  if (isBillingOwner) {
    Alert.alert(
      "Billing owner",
      `${displayName(item)} is the billing owner — the only person who can approve teammates and change the subscription.`,
    );
    return;
  }
  if (!eligible) {
    Alert.alert(
      "Not eligible",
      "The billing owner must be an owner or admin. Change this person's role first.",
    );
    return;
  }
  if (!canTransferBilling) {
    Alert.alert(
      "Not allowed",
      "Only an owner or the current billing owner can change who pays.",
    );
    return;
  }
  transferBilling(item);
}

// ── the interactive $ badge (in renderItem) — was TouchableOpacity + onBadgePress ──
// const eligibleForBilling =
//   item.user_profile === "owner" || item.user_profile === "admin";
<TouchableOpacity
  onPress={() => onBadgePress(item)}
  hitSlop={theme.layout.hitSlop.medium}
  style={[
    styles.dollarBadge,
    isBillingOwner && styles.dollarBadgeActive,
    !isBillingOwner && !eligibleForBilling && styles.dollarBadgeMuted,
  ]}
  accessibilityLabel={isBillingOwner ? "Billing owner" : "Set as billing owner"}
>
  <MaterialCommunityIcons
    name="currency-usd"
    size={16}
    color={
      isBillingOwner
        ? "#fff"
        : eligibleForBilling
          ? theme.colors.primary
          : theme.colors.textFine
    }
  />
</TouchableOpacity>

// ── help-text (ListHeaderComponent) — the transfer-capable version ──
// "Tap a role to change a member's permission. Tap the $ to choose who pays for
//  the org — the billing owner is the only one who can approve teammates or
//  change the plan."

// ── style (dropped when the muted state went away) ──
// dollarBadgeMuted: {
//   borderColor: theme.colors.input,
//   backgroundColor: "transparent",
//   opacity: 0.5,
// },
```

## To revive
1. Paste the functions/state back into `app/manageusers.jsx`, restore the interactive `$` badge +
   `eligibleForBilling` + the transfer help-text and the `dollarBadgeMuted` style.
2. Reconsider the transfer UX gap first (memory + `V2-FEATURES.md`): after a transfer, tell the old
   payer to cancel their Apple sub, and/or keep "Manage Subscription" visible to a former payer who
   still holds an active sub so they can cancel in-app. Ideally couple the transfer to the new owner
   actually subscribing.
3. No server change needed — `set_billing_owner` and the guard already support it.
