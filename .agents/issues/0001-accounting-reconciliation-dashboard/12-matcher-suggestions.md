# 12 — Matcher suggestions

Type: AFK
User stories: 42, 43

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Turns the manual pairing of slice 09 into one-click confirmation for the obvious cases.

`Matcher` is a pure module taking candidate payments and proofs and returning ranked suggestions,
each with a stated reason so the suggestion is explainable rather than magic. Tiers, in order:

1. Exact variabilný symbol match — on Slovak transfers the VS usually equals the invoice number,
   making this the strongest available signal.
2. Amount plus counterparty IBAN.
3. Amount plus date proximity plus fuzzy counterparty name.
4. For card receipts from `05 Bločky_firemná karta`, amount plus timestamp proximity, since a card
   slip carries no VS. The eKasa timestamp from slice 06 is exact, which makes this tier stronger
   than it would otherwise be.

Auto-pairing happens **only** when exactly one candidate matches at the top applicable tier.
Anything ambiguous is presented as a ranked suggestion for her to choose. Auto-created pairings are
marked as such so she can tell them from her own, and can unpair them like any other.

Many-to-many candidates matter: a single transfer whose amount equals the sum of three outstanding
invoices should be proposed as a combined match, and installments against one invoice should be
proposed too.

No machine learning. This is deterministic tiered matching.

## Acceptance criteria

- [ ] A VS match outranks an amount match for the same payment
- [ ] A single top-tier candidate auto-pairs and is marked `auto`
- [ ] Two equally-ranked candidates produce suggestions and no auto-pairing
- [ ] One payment matching the sum of three invoices is proposed as a combined pairing
- [ ] Installments against a single invoice are proposed
- [ ] An amount differing by one cent does not match on an amount-based tier
- [ ] Card receipts match on amount plus timestamp proximity when no VS is present
- [ ] Every suggestion displays the reason it was suggested
- [ ] An auto-created pairing is visually distinguishable from a manual one and can be unpaired
- [ ] Auto-pairing never sets her tick — confirmation stays hers, per ADR 0010
- [ ] Integration test: a realistic month produces the expected auto-pairs and leaves the ambiguous ones as suggestions

## Blocked by

- 09 — Manual pairing, tick and what's-left
- 11 — Invoice text extraction and field confirmation
