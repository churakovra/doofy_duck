# Doofy Duck — product, progression, sharing, and monetization research

Research date: October 14, 2026. Status: research and proposed product direction, not approved implementation or legal clearance. Existing architecture ADRs remain unchanged.

**Owner update:** `PRODUCT_DIRECTION.md` records the current 18+ audience, commercial focus, approved challenge/daily-route direction, deferred failure sharing, rejected visual concepts, and planned Reels/TikTok acquisition. It supersedes conflicting discovery and prioritization assumptions below; this report is retained as historical research.

## 1. Owner discovery: confirmed inputs

- Audience: Russian-speaking players in CIS countries, approximately 16–36 years old. The proposed audience includes minors.
- Acquisition proposition: earn in-game Stars and redeem them for gifts; the business should also encourage voluntary spending and purchases of actual Telegram Stars products.
- Art preference: modern pixel art, cozy worlds, expressive ducks, funny failures. Owner wants multiple visual concepts before selecting a direction.
- Desired monetization: direct cosmetics, cosmetic boxes, world appearances, effects, gameplay advantages, and optional continues.
- Budget: approximately USD 500. Owner availability: 10–15 hours per week. AI agents expected to implement and test.
- Not established: exact launch countries, operator jurisdiction, gift funding, existing distribution, whether AI inference costs are included in the budget, and age eligibility for paid/redeemable features.

## 2. Executive recommendation

Build an appealing skill game with a bounded gift-reward layer, not a machine that secretly creates failure to sell relief. The proposed identity is: **a cozy, funny pixel duck arcade game where you master routes, challenge friends, collect a flock, and can redeem eligible earned points for specified gifts**.

The most important product experiment is whether players return and customize their ducks when no additional redeemable reward is available. This does not mean hiding or changing promised rewards: compare clearly described experiences and honor existing balances. An acquisition promise based only on earning is an unvalidated business hypothesis.

Do not launch all requested monetization simultaneously. Start with transparent direct cosmetics. Separate assisted play from fair competition and from gift-earning play. Defer paid randomized items and monetary advantages pending jurisdiction, age, platform, funding, and abuse review.

No source establishes that these features will make Doofy Duck viral or profitable. Recommendations below are hypotheses for this product.

## 3. Evidence and what it does—and does not—show

### Motivation

Przybylski, Rigby, and Ryan's motivational model links game engagement with experiences of competence, autonomy, and relatedness. The authors also describe limitations in the evidence and distinguish wanting to play from compelled engagement. This supports designing mastery, meaningful choice, and social connection; it does not predict retention or spending for our audience.[6]

### Difficulty adaptation

Colwell and Glavin studied difficulty adjustment in a custom castle-defense game with thirty participants and reported questionnaire-based enjoyment improvements. This is a small, different-game result, not evidence that adapting an arcade game will increase revenue. Fair adaptive training is worth testing; intentionally arranging a payable failure is not the same intervention.[11]

### Comparable arcade systems

Crossy Road's official support documents secret character unlocks, a premium character, and a prize machine that can yield duplicates. Lesson for us: cosmetics and secrets can surround a very small core loop. Do not infer which mechanic caused its success or copy duplicate frustration automatically.[5]

Halfbrick's historical 2012 Jetpack Joyride update describes coin-purchased gadgets with gameplay effects and loadout choices. Its support separately explains that some event modes block gadgets. Lesson for us: loadout variety and mode-specific restrictions are concrete design precedents, not proof of their current revenue effect.[9][10]

### Telegram distribution and commerce

Telegram documents Mini App deep-link parameters, prepared-message sharing, story sharing, and write-access requests. These make challenge links and voluntary result sharing technically feasible; availability and fallback behavior still need client testing.[1]

Digital goods sold through bots/Mini Apps must use actual Telegram Stars, XTR. Fulfillment must follow successful payment, and payment support/refunds must exist.[2]

The Bot API's sendGift contract explicitly distinguishes bot-delivered gifts from convertible wallet Stars: the recipient cannot convert these gifts to Telegram Stars. Do not market our rewards as guaranteed Stars withdrawal or liquidity.[3]

Telegram's developer terms prohibit unsolicited spam and misrepresentation, and require appropriate privacy practices. These are constraints on referral, notifications, and analytics design.[4]

Apple's guidelines require pre-purchase odds disclosure for purchased randomized virtual items. This is a platform guideline, not a determination of the treatment of our Mini App in every client, or legal permission for CIS markets.[8]

## 4. The proposed product loops

### Moment-to-moment

Tap → navigate a readable obstacle pattern → choose a safe or more demanding collectible route → receive clear feedback → encounter a short breathing section → face the next pattern.

Rules: identical visible physics, consistent hitboxes, no moving a collectible or obstacle because a payer is near a record, and no loss of previously verified earnings on death. Difficulty should produce understandable errors and improvement opportunities.

### Session

Choose a cosmetic or mastery objective → play a few short runs → see progress and a useful improvement hint → customize or issue a friend challenge → voluntarily play again or leave.

Avoid an energy system initially. Do not turn ordinary replay into a currency purchase. A player should always be able to start a fresh free run.

### Multi-day

Complete a small rotating challenge → progress toward a duck/world appearance → compare a fixed-seed daily score → optionally contribute to a future group cosmetic project.

Do not reset ownership, delete earned currency, or punish a missed day. Test nonconsecutive weekly goals before a strict daily streak.

## 5. Feature shortlist and priority

All impact assessments here are design judgments, not measured forecasts.

| Feature | Player value | Business hypothesis | Priority / constraint |
|---|---|---|---|
| Immediate replay and clear collision feedback | Skill improvement | Better voluntary replay | First playable |
| Expressive duck reactions and short failure captions | Personality | Distinctive share material | First playable |
| One visible cosmetic goal | Progress and choice | Feathers have a desirable use | First playable |
| Direct cosmetic catalog and preview | Self-expression | First transparent purchase | First paid slice |
| Friend challenge on the same seed | Meaningful comparison | Qualified social acquisition | Early alpha |
| Daily fixed-seed route | Familiar return activity | Repeat participation | After core fairness |
| Secret ducks earned through specific feats | Discovery | Community discussion | Early expansion |
| Cosmetic trails and world palettes | Personal taste | Repeat cosmetic spending | After asset readability tests |
| A small cozy home pond | Visible collection | Long-term feather sink | Later; content-cost risk |
| Weekly shared flock objective | Cooperation | Community return loop | Later; anti-farm limits |
| Casual gadgets and one continue | Alternate play | Optional convenience spending | Gated experiment |
| Paid cosmetic loot boxes | Surprise | Randomized cosmetic revenue | Defer |
| Pass/subscription | Ongoing content | Recurring purchases | Defer until content cadence exists |
| Paid prize tournaments or earning multipliers | Financial competition | Higher spend | Exclude from initial plan |

## 6. Viral mechanics: give a reason to invite

### Friend challenge: first social feature

A verified run produces a challenge containing a seed, rule version, unassisted score, and cosmetic identity. The recipient opens the challenge, plays the same conditions, and can send a result back. Use an opaque challenge identifier in the launch parameter; resolve and validate it on the server. Telegram launch parameters and prepared-message sharing support this transport.[1]

Russian example: “Я пролетел дальше этой трубы. А ты?” Do not fabricate a friend's achievement or imply a contact played without evidence. Friendboards must come from voluntary challenge/group participation, not assumed access to a player's contacts.

### Shareable failures

Start with a lightweight result card: duck, scene, score, real record status, and playful caption. Example: “План был отличный. Труба не согласилась.” Do not call a still image a gameplay replay. Later evaluate a short client-rendered replay from a bounded input buffer; real-time video multiplayer is unnecessary.

### Daily route and group identity

Offer the same daily route to everyone in the applicable rules category. Later let groups contribute verified play toward a nonfinancial pond decoration. Groups and creators could receive branded cosmetic challenges with permission.

### Referral boundaries

No mandatory invites to redeem. No contact scraping, automatic posting, multi-level recruitment, or rewards for joining unrelated channels. If referrals are tested, use modest non-redeemable cosmetic rewards for qualified play, not cash-like rewards for account creation. Telegram prohibits unsolicited spam and misrepresentation; growth design must respect that.[4]

## 7. Difficulty director: pacing without rigging

### Use a simple rule-based system first

No live LLM is needed to place pipes. Proposed segments have parameters for speed, gap size, vertical movement, recovery space, and collectible paths. An offline reachability check rejects impossible transitions. Fixed-point simulation and shared TypeScript/Go vectors remain required.

Separate purposes:

1. **Tutorial/practice:** disclosed assistance can select gentler patterns based on demonstrated skill; practice cannot mint redeemable rewards.
2. **Ranked/daily/reward-bearing:** a fixed versioned ruleset and deterministic schedule, with no adaptation based on purchase history, available balance, or likelihood of paying.
3. **Casual assisted:** explicit gadgets/continues and separate records.

The small DDA study supports an enjoyment hypothesis to test, not a spending optimizer.[11]

### How to place collectible Stars

Prefer visible, explainable milestones or bounded eligible objectives. Put optional bonus routes beside a safe route; signal their difficulty and preserve an escape path. Distinguish a pending client pickup from verified credited currency.

Redeemable issuance must obey a published funded policy. Never secretly reduce a player's eligibility as they approach redemption. If earning eligibility has a limit, show it before play; already credited claims remain honored.

### What not to build

No artificial collision near a personal best, fake near-miss, impossible pattern to trigger a continue, increased difficulty for high balances, individualized reward starvation, or repeated paid-rescue countdowns. The director optimizes play quality, not inferred vulnerability or financial pressure.

## 8. Paid advantages and continues

Proposed product policy, pending approval:

- Unassisted ranked/gift-earning runs use identical physics and no paid advantages.
- A casual assisted category may allow a shield, feather-only collection magnet, or one continue.
- Assisted runs earn no redeemable GAME_STAR and do not enter the unassisted prize/record category.
- A magnet must never multiply redeemable earnings; cosmetic skins must never change hitboxes.

A continue should show a fixed known price and a clear free restart alternative. Test one earned continue before offering paid ones. Do not escalate price within a run or use a misleading countdown. A real near-record status can be displayed, but never engineered by secretly arranging death.

Technical contract: a death remains immutable. A continue, if approved, creates an explicitly linked continuation with assisted status and a versioned entitlement; it does not reopen a terminal reward-bearing run. Preserve the verified pre-death result and prior earnings. Prevent duplicate charges/consumption, handle delayed payments, provide a safe re-entry segment, and define compensation if continuation cannot be delivered.

Mode restrictions have precedent in Halfbrick's event system, but our exact rules need player testing.[10]

## 9. Economy: two internal currencies, one payment rail

| Unit | Role | Proposed sources | Proposed sinks |
|---|---|---|---|
| Feathers | Non-redeemable progression | Verified ordinary play, mastery objectives | Standard cosmetics, pond decoration, casual consumables |
| GAME_STAR / in-game Stars | Eligible gift-redemption points | Published pre-funded reward policy | Gifts; optional clearly priced cosmetic purchases |
| XTR / Telegram Stars | External payment asset | Player purchase through Telegram | Direct catalog purchase/supporter product |

Display all units distinctly. Do not sell GAME_STAR or a paid route to faster gift earning in the first release. Prefer XTR invoices for named, directly delivered items. Telegram requires XTR for digital sales; an internal balance is not a Telegram wallet balance.[2][3]

Business accounting:

Contribution = realizable external receipts − refunds/payment deductions − actual gift costs − variable delivery/support/acquisition costs.

Spending earned GAME_STAR can extinguish part of a reward claim under the disclosed rules. It does not create external revenue. Monetization must work without trapping a player who wants to redeem instead of buying a skin.

Before issuance, define: selected eligible gifts, provider cost, funding reserve, issuance limits, attainable redemption path, eligibility, geographic availability, refund handling, and unknown delivery outcomes. If gift availability changes, do not silently erase claims or replace them with a worse undisclosed outcome. Stop new commitments when funds are insufficient; honor existing commitments.

A seed visible to clients makes automation possible. Verification proves legal inputs, not a human player. Published reward caps, abuse controls, and auditability are prerequisites to funded rewards.

## 10. Monetization ladder

1. **Direct skins:** a small previewable catalog with exact items and price.
2. **Cosmetic bundles:** duck + matching trail + profile decoration, with no earning benefit.
3. **Cosmetic world palettes:** same obstacle readability, hitboxes, and reward policy.
4. **Supporter product:** optional badge/cosmetics; never a promise of investment return.
5. **Casual conveniences:** only after the category and fulfillment rules above are approved.
6. **Content pass:** only when we can reliably produce the advertised content.

Start with a narrow catalog rather than many near-identical items. Let players preview an item on their duck and identify an attainable free goal. Do not claim fake scarcity, reset fake sale timers, conceal the total price, or change offers using a player's losses or inferred financial vulnerability.

### Loot boxes

Owner interest is recorded, not treated as launch approval. For the initial build use direct purchases and deterministic cosmetic unlocks. If random cosmetics are later considered, first resolve exact countries, operator rules, minimum purchase age, platform constraints, and review cost. Audience targeting at 16+ alone is not a safety or eligibility control.

Minimum proposed design boundaries: cosmetic-only contents; no redeemable points, gifts, tradable value, or competitive power; visible odds and exact cost; published duplicate handling; an attainable guaranteed/direct route; no paid reroll pressure. Apple requires odds disclosure for purchased randomized virtual items, but disclosure alone does not establish legal or platform permission.[8]

## 11. Visual direction: modern cozy pixel art

These briefs are accompanied by `VISUAL_CONCEPTS.html`: nine original, code-drawn pixel sketches (three directions with three environments each). They are static composition/palette studies, not production sprites, animation, a playable game, or a final art selection. The sheet was rendered in isolated headless Chrome and its screenshot visually inspected; all nine scenes and Cyrillic captions were visible. Dark-city obstacle contrast needs refinement before playtesting.

### A. Golden Pond — recommended starting direction

Honey-yellow duck, sage reeds, warm water reflections, dusk lavender. Duck has a large readable eye and exaggerated wing poses. Failures are harmless splashes and surprised expressions. Cozy, memorable, and compatible with a small reusable asset set.

Variants to render later: sunrise pond, rain on lily pads, golden autumn marsh.

### B. Duck After Hours

Sleepy duck, rainy rooftops, indigo sky, warm windows, restrained neon. Humor centers on exhausted commutes and overambitious shortcuts. Strong modern personality, but effects must not obscure obstacles.

Variants: quiet tram stop, rooftop garden, midnight laundromat.

### C. Postcard Explorer

Small adventurous duck with optional scarf/backpack, soft mountain lakes, seaside villages, floating islands. Worlds become collectible postcards. Good world-palette product potential, but substantially more environment content.

Variants: alpine lake, sunset harbor, sky garden.

Art acceptance: consistent pixel grid and camera scale; legible silhouette on a small phone; high-contrast obstacle edges; identical skin hitboxes; reduced-motion setting; no screen shake needed to read a collision; sound optional; tasteful Cyrillic type. Evaluate all directions using the same scene, duck animation, death state, and shop card, rather than judging unrelated attractive illustrations.

## 12. Scope and budget

Proposed allocation of the USD 500, not researched vendor quotes or commitments:

| Envelope | USD |
|---|---:|
| Hosting/backups/monitoring trial | 100 |
| Licensed art, sound, or focused polish | 80 |
| AI tooling/inference | 100 |
| Controlled gift tests/reward reserve | 50 |
| Uncommitted contingency | 170 |
| Total | 500 |

Do not treat USD 50 as an adequate public reward pool or USD 170 as a quote for legal review. It may be insufficient to enable paid chance-based/redeemable mechanics safely. Keep those disabled rather than spending the full budget upfront. If subscriptions are already paid, reassign that envelope deliberately.

AI agents can implement code and execute tests. The owner still needs to approve economics, inspect art and real-device gameplay, handle accounts/support, and review risky releases. No fixed delivery date is defensible before a vertical slice demonstrates actual iteration cost.

### Delivery gates

A. Fun prototype: one world, expressive duck, deterministic physics, replay, bounded runs, no real rewards.

B. Social alpha: transparent progress, small direct cosmetic catalog, verified challenge cards, simple analytics.

C. Paid slice: real test-environment purchase/refund exercise, durable inventory, support and audit trail. Telegram provides a Stars test environment.[2]

D. Controlled gift pilot: selected gift receipt validated, funded issuance and reconciliation, eligibility and jurisdiction review.

E. Expansion: daily routes, secret ducks, palette packs; only then assess casual continues, boxes, passes, and group features.

No guaranteed delivery calendar or retention outcome is claimed.

## 13. Measurement and experiments

Instrument privacy-minimized events: tutorial steps; run start/end; collision category; accepted checkpoint; verified reward; cosmetic preview/equip; share intent/success where supported; qualified challenge start; purchase confirmation; entitlement grant; redemption states. Version rules and experiment assignment. Do not log raw auth data or infer vulnerability from losses. Telegram requires appropriate privacy disclosure and limited data handling.[4]

Primary product measures: meaningful first-run completion, voluntary replay, next-day/seven-day cohort return, skill improvement, cosmetic engagement, qualified challenge participation, and satisfaction/fairness feedback. Track full cohort counts and uncertainty; do not invent industry benchmarks.

Commercial measures: confirmed payer conversion, refund/complaint rate, cost per qualified retained player, realizable contribution, reward reserve coverage, unresolved redemptions, and revenue concentration. Time spent and immediate continue purchases are not sufficient success measures.

Experiments:

- Does expressive failure feedback improve voluntary replay without raising frustration?
- Does a visible cosmetic goal improve return when reward promises are held fixed?
- Does a same-seed challenge bring more qualified players than a generic invite?
- Can players explain Feathers, GAME_STAR, and XTR correctly before spending?
- Does an earned casual continue improve enjoyment without confusing record/reward eligibility?

Use predefined hypotheses, assignment, observation windows, primary outcomes, and complaint/fairness guardrails. With a small cohort, prioritize interviews and report directional evidence rather than statistical certainty. Never experiment with unannounced withdrawal eligibility, hidden forced failures, undisclosed odds, or promised balances.

## 14. Open product decisions

1. Exact launch countries and operator location; what age restrictions apply to paid and redeemable features?
2. Is USD 500 total or monthly, and does it include existing AI subscriptions?
3. Will the owner accept paid advantages only in assisted play with no redeemable earnings?
4. May the first public alpha launch before gift earning, while clearly labeled as such?
5. Which concept should receive the first comparable visual mockups?
6. Existing audience, creator relationships, and willingness to personally handle support?
7. Which specific gifts and funded earning/redemption policy are viable?

## 15. Research and verification boundary

Reviewed ten primary sources: Telegram documentation/terms, official Crossy Road and Halfbrick materials, Apple's guidelines, an original difficulty-adjustment paper abstract, and a game-motivation research paper. The framework paper is a research synthesis, not an original experiment measuring this game. The Halfbrick gadget article is historical. No CIS market survey, user interviews, comparable-game financial dataset, local legal opinion, current vendor quote, performance benchmark, gift transaction, or live acquisition experiment was completed.

The configured page-extraction tool failed; direct page retrieval recovered the cited source bodies. An FTC enforcement example appeared in search, but direct retrieval failed, so it is excluded from the evidence and conclusions.

Created a research document, source ledger, and static visual comparison board. No gameplay, payment, reward policy, odds, growth campaign, or production configuration has been implemented. Recommendations require owner approval.

## Sources

[1] https://core.telegram.org/bots/webapps
[2] https://core.telegram.org/bots/payments-stars
[3] https://core.telegram.org/bots/api
[4] https://telegram.org/tos/bot-developers
[5] https://www.hipsterwhale.com/crossy-road-support
[6] https://selfdeterminationtheory.org/SDT/documents/2010_PrzybylskiRigbyRyan_ROGP.pdf
[8] https://developer.apple.com/app-store/review/guidelines
[9] https://www.halfbrick.com/blog/in-depth-jetpack-joyride-gadgets
[10] https://halfbrick.helpshift.com/hc/en/4-jetpack-joyride/faq/768-my-gadgets-are-blocked-when-playing-in-event-mode/?f=dan-the-man&p=winpc&s=games
[11] https://arxiv.org/abs/1806.04471
