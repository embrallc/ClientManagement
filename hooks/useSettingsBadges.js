import { useSettingsStore } from "../stores/useSettingsStore";
import { useSubscriptionStore } from "../stores/useSubscriptionStore";

// Teammates waiting on a seat decision. Only the BILLING OWNER can act on these
// (Approve = buy a seat) and is the only one with an Approvals entry in Settings
// (the SUBSCRIPTION "Review Approvals" row). So the badge counts for them alone —
// otherwise a non-billing co-owner would light up the Settings tab with no row
// inside to resolve it. Co-owners remove teammates from Manage Users instead.
// (Members always get an empty pendingApprovals list from the server anyway.)
export function usePendingApprovalsCount() {
  return useSubscriptionStore((s) =>
    s.status?.isBillingOwner === true
      ? (s.status?.pendingApprovals?.length ?? 0)
      : 0,
  );
}

// Single source of truth for the aggregate red badge on the Settings (menu)
// button: the sum of every unviewed notification surfaced inside Settings.
// Today that's unviewed cancellations + pending seat approvals — add future
// Settings notification counts here so every placement of the icon stays in sync.
export function useSettingsBadgeTotal() {
  const cancelled = useSettingsStore((s) => s.unviewedCancelledCount);
  const productNotifs = useSettingsStore((s) => s.unviewedProductNotifCount);
  const approvals = usePendingApprovalsCount();
  return cancelled + productNotifs + approvals;
}
