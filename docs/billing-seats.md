# Zanbi — how seats, approvals, and downgrades behave

A plain-language reference for how the per-seat subscription reacts to team changes.
Source of truth: the `subscription-status` Edge Function (`seats` vs `members` + the ranking/grace logic).

## The two rules everything follows

1. **Seat ranking.** Everyone in the org is ordered **owners first, then by join date (oldest → newest)**.
   The first `seats` people hold the paid seats; anyone beyond that (the **newest-joined** members) is
   "over a seat." A member is over a seat **only when `seats < members`**.

2. **"Over a seat" ≠ removed.** An over-seat member gets a **15-day grace** (counted from the day they
   *joined*), during which they keep full access. After grace they become **locked** — they hit the lock
   screen and can't use the app, **but their account and all their inspections/photos are kept**. Add a
   seat back and they're restored instantly. Nothing is deleted unless you explicitly **Remove** them.

## Who loses the seat on a downgrade?

Always the **most-recently-joined member(s)** — automatically, not your choice.
Example: 4 seats / 4 members, you Reduce Plan to 3 → at the next renewal the **newest** member locks
(data preserved); the owner and the two oldest members keep their seats.

➡️ **To drop a *specific* person** who isn't the newest: **Remove them first** (Manage Users → trash, or
Approvals → Deny), *then* Reduce Plan.

## Does removing someone lower my bill automatically?

**No.** Removing a user lowers your member count, but the subscription still charges for the number of
seats you **purchased**. After a removal you'll see **"Reduce Plan — you're paying for N unused seats"**.
You must tap **Reduce Plan** to actually lower the charge (it takes effect at the **next renewal**;
Apple/Google don't issue mid-cycle refunds). Nothing shrinks the plan based on headcount on its own.

## The safe real-world flow (a teammate leaves)

1. **Remove** the person who left (Manage Users). → members drops by one; you now have an unused seat.
2. **Reduce Plan** down to your **remaining member count** — e.g. 4 → 3 when you have 3 people left.
3. At the next renewal `seats == members`, so **no other member is affected.** Clean.

⚠️ The **only** thing that locks a still-active member is reducing seats **below** your current headcount.
Rule of thumb: **reduce down to your member count, never below it.**

## What about someone trying to game it?

There's no "downgrade but keep the extra person active" trick. Dropping seats below headcount **always**
locks the excess members (newest first) at renewal — seats gate active membership, so keeping N people
active means paying for N seats. The only free window is the intentional **15-day approval grace** given
to a brand-new teammate so the owner has time to approve (or deny) them.

## Quick reference

| Action | Effect on billing | Effect on members |
|---|---|---|
| Teammate joins with org key | none yet (15-day grace) | active during grace; locks after 15 days unless approved |
| **Approve** a teammate | +1 seat charged now (immediate upgrade) | they stay active |
| **Deny** / **Remove** a teammate | none (must Reduce Plan to save money) | that person is deleted; records → Unassigned |
| **Reduce Plan** (seats ≥ members) | lower charge next renewal | nobody locks |
| **Reduce Plan** (seats < members) | lower charge next renewal | **newest** over-seat members lock at renewal (data kept) |
