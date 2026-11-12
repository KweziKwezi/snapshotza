# SnapshotZA: Monetization, Payout and Refund Policy

Status: **approved by the owner; for attorney review.** This is the business logic built into the app
(database migration `20261118000014_final_money_policy.sql`) and the basis of the plain-language Terms and Refund
Policy. It is not legal advice: a South African attorney must review the final Terms before real money is taken.

## 1. The short version

| Item | Rule |
|---|---|
| Client pays | **Saver rate:** the package price. **Flexible rate:** the package price **+ R150**. Paid 100% upfront. |
| Our commission | **7% of the package price**, deducted from the photographer's share. |
| Payment processing | **2.9% + R1.00** of the package price (Paystack standard rate, VAT exclusive), deducted from the photographer's share. |
| Photographer receives | Package price minus commission minus processing: the **Net Amount**. The R150 Flexible fee is not part of it. |
| Paid in two parts | **Deposit:** 30% / 40% / 50% of the Net (Tier 1 / 2 / 3), released when the shoot is confirmed. **Final:** the rest, released when the client approves the photos (or after 48 hours). |
| Payout transfer fees | **The platform absorbs** the ~R3.00 Paystack transfer fee. |
| Deposit refundable? | **No.** Once released to the photographer, the deposit is theirs. |
| Client cancels | Depends on the rate chosen at checkout (section 3a). |
| Photographer cancels or no-show | Client gets **100% of what they paid back**, including the R150, within 14 days. Photographer gets R0 and a strike. |
| Dispute: client wins | Client gets the **unpaid Final portion** back. Photographer keeps the released Deposit. |
| Dispute: photographer wins | Photographer receives the Final portion. |
| Minimum withdrawal | R100. |

## 2. How the money is split (worked example)

R2,400 package, Tier 1 photographer (30% deposit).

| | Saver | Flexible |
|---|---|---|
| Client pays | R2,400.00 | **R2,550.00** (R2,400 + R150) |
| Platform commission (7% of R2,400) | R168.00 | R168.00 |
| Paystack processing (2.9% + R1 of R2,400) | R70.60 | R70.60 |
| **Net to photographer** | **R2,161.40** | **R2,161.40** |
| Deposit (30% of Net) | R648.42 | R648.42 |
| Final (70% of Net) | R1,512.98 | R1,512.98 |
| Platform keeps | R168.00 | R168.00 + R150 |

The photographer earns the same on both rates. The R150 pays for the flexibility (refunds, date changes) and is
never refunded, except when the photographer is at fault.

| Tier | Deposit | Final |
|---|---|---|
| 1 (30%) | R648.42 | R1,512.98 |
| 2 (40%) | R864.56 | R1,296.84 |
| 3 (50%) | R1,080.70 | R1,080.70 |

VAT: SnapshotZA is not VAT-registered. Once turnover crosses the R1 million threshold, the 7% commission will be
treated as VAT-inclusive. Photographers handle their own VAT.

## 3. Refunds: what happens in each situation

All refunds go back to the original payment method within **14 days** of the decision.

### 3a. The client cancels (chosen at checkout)

The client actively chooses one of two rates (nothing is pre-selected) and ticks a box accepting that rate's terms
before paying.

**Saver rate (package price)**
- Client cancels at any time: **no refund**. The photographer keeps 100% of the Net Amount (paid once the original
  shoot date has passed).
- Date changes: **not permitted**.

**Flexible rate (package price + R150)**
- Client cancels **48 hours or more** before the shoot: **the package price is refunded in full** (R2,400 in the
  example). The R150 is kept by the platform; it covers the processing fee we cannot recover and the refund transfer.
- Client cancels **less than 48 hours** before: **no refund**. The photographer keeps 100% of the Net Amount.
- Date changes: **one free change**, requested at least 48 hours before the shoot, and only if the photographer
  approves. A request the photographer does not answer within 48 hours lapses. The 48-hour cut-off then applies to
  the new date.

### 3b. The photographer cancels or does not show up

- **Cancels at any time:** the client receives 100% of what they paid (including the R150). Photographer: R0 and a strike.
- **No-show** (reported by the client, confirmed by our team): the same, within 14 days.
- **Strikes:** 1st = warning and a visible strike. 2nd = 30-day suspension (lifted automatically). 3rd = permanent
  removal. Photographers may appeal with valid proof (for example, a tow invoice).

### 3c. The client does not show up

No refund. The photographer receives 100% of the Net Amount, as if the shoot happened.

### 3d. A problem after the shoot (a dispute)

Our team reviews the booking (messages, photos, evidence) and decides within **5 working days**. Any money not yet
withdrawn is frozen meanwhile. The Deposit has already been released and is non-refundable: disputes only concern
the Final portion.

| Decision | Client | Photographer |
|---|---|---|
| Client wins | refunded the share of the package price not yet paid out (Tier 1 example: R1,680) | keeps the Deposit |
| Photographer wins | R0 | receives the Final portion |
| Split | a chosen percentage of the unpaid share (for example 50%) | the rest of the Final portion |

### 3e. Photos delivered, but the client goes quiet

After 48 hours the photos count as approved and the Final payment is released. Downloads stay available for 15
days, then are deleted.

## 4. When the photographer gets paid

1. Client pays: the money is held, not yet the photographer's.
2. Shoot happens: photographer taps **Mark shoot complete**; client taps **Yes**, or 24 hours pass. **Deposit released.**
3. Photographer uploads the edited photos and taps **Deliver**.
4. Client approves, or 48 hours pass. **Final released.**
5. Photographer withdraws (minimum R100); our team pays within 2 working days and marks it sent.
6. If a problem is reported, unwithdrawn money is frozen until it is decided.

## 5. Protection for photographers
- The Deposit is never refunded once released.
- No disputes after the photos are approved, or more than 7 days after the 48-hour auto-approval window.
- False reports can lead to a warning or account closure.
- Chargebacks: a photographer repays a chargeback caused by their own failure to deliver. Holding the Final payment
  during the review window reduces this risk.

## 6. Protection for clients
- Money is held until the shoot is confirmed, and the Final portion until the photos are delivered.
- 100% back (including the R150) if the photographer cancels or does not show up.
- Photos downloadable for 15 days; chats deleted after 20 days (kept while a dispute is open).
- An in-app way to report a problem, with a human decision and a written reason within 5 working days.

## 7. Where each rule lives in the app

| Rule | Where it is enforced |
|---|---|
| 7% + 2.9% + R1 | `calc_amounts`; settings `platform_fee_rate`, `transaction_fee_rate`, `transaction_fee_flat` |
| Saver / Flexible, R150 | `create_booking(..., p_rate)`; setting `flexible_fee`; checkout rate picker and tick box |
| Cancellations | `cancel_booking`, `release_forfeit` (pays the photographer after the shoot date) |
| Date changes | `request_reschedule`, `decide_reschedule`, `expire_reschedules` |
| Disputes and split | `admin_resolve_dispute(..., p_client_pct)`; `decision_due_by` (5 working days) |
| Strikes | `apply_strike`, `lift_suspensions` |
| Refunds within 14 days | `refund_due_by`; admin **Refunds to send** screen; `admin_mark_refund_sent` notifies the client |
| Minimum withdrawal R100 | `request_withdrawal`; setting `min_withdrawal` |

Not yet automated: the transfers themselves (refunds and payouts are sent by our team until Paystack is connected),
and the "no disputes after 7 days" rule (problem reports currently close once a booking is completed).

## 8. Things a lawyer must check (not legal advice)
- **CPA section 17:** that offering a Saver rate (lowest price, no refund) next to a Flexible rate (R150 more,
  refundable) makes the no-refund term a reasonable, freely chosen cancellation charge.
- **ECTA section 44:** whether photography bookings fall under the exemption for leisure services on a specific
  date. If not, a 7-day cooling-off refund is needed for bookings made more than 7 days ahead.
- **Clear disclosure:** the rate's terms are shown and must be ticked before payment (built).
- **POPIA:** privacy policy, retention periods (photos 15 days, chats 20 days), named Information Officer.
- **Holding funds:** that Paystack's split payment / subaccount set-up keeps SnapshotZA from holding third-party
  funds in a regulated way.
