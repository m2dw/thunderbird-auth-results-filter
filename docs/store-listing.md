# Thunderbird Add-ons Store Listing

## English

### Summary (short description, ≤ 250 characters)

Cuts through spam and phishing noise: suspicious mail is set aside in a Review folder, notifications can be limited to mail that passes your chosen trust threshold, and every decision is explained. All processing stays on your device.

---

### Full Description

Tired of new-mail notifications for junk and phishing attempts? **Thunderbird Auth Results Filter** quietly sets aside suspicious incoming mail in its own Review folder, so your Inbox and your notifications stay focused on messages worth your attention — and it always tells you why a message was flagged.

This add-on supplements your mail server's spam filtering rather than replacing it. It works alongside whatever spam/junk handling your provider already does, adding a second, transparent layer of protection you control.

### What it solves

- **Fewer noisy notifications, on your terms.** Turn off Thunderbird's standard new-mail popup and opt in to the add-on's own notifications, which only fire for messages at or below a score limit you choose. By default that limit only covers mail that looks safe, but you can raise it to also be notified about messages sent to Review — the choice is yours.
- **Suspicious mail, set aside for review.** Messages that look risky are moved to a dedicated "Auth Review" folder instead of sitting in your Inbox, so you can look at them on your own time instead of triaging them as they land.
- **Clear, visible reasons.** Every message gets a plain-language explanation — not just a score. Open the add-on's popup on any message to see exactly which signals contributed, including protective factors that kept a message out of Review.
- **Self-service correction.** If a legitimate message is flagged, move it back to the Inbox, or whitelist the sender from the popup — whitelisting shows a confirmation step so you don't do it by accident.

### How it decides

The add-on looks at sender authentication (SPF, DKIM, and DMARC — the checks mail servers use to confirm a message really came from where it claims to) together with characteristics of the sender's address and domain. With default settings, no single weak signal moves a message out of your Inbox on its own — multiple independent signals have to line up before mail is set aside for review. This reduces false positives from ordinary forwarded mail, mailing lists, and newsletters. Advanced settings let you adjust how much weight those secondary signals carry, so this balance can be changed from the defaults described here.

### Trust, explained simply

The add-on only accepts authentication results from mail servers **you explicitly mark as trusted** — nothing is trusted automatically. Authentication information from servers you haven't approved is recorded for your own visibility but never influences scoring, so it can't be spoofed into affecting a decision.

### Privacy

Everything — message evaluation, decision history, and settings — is processed and stored locally on your device. Nothing about your mail is sent anywhere by default.

The one optional exception is a DNS lookup in the setup assistant, used only to suggest a starting `authserv-id` value when you're configuring trusted servers. It is **off by default**, sends only your account's email domain (never message content), and any suggestion it returns must be added manually — nothing is trusted automatically as a result of it.

### Setup

1. Open the add-on's Options page.
2. Under **Trusted Authentication Servers**, add the identifier your mail server uses when it signs authentication results (the setup assistant can suggest one, or you can enter it manually).
3. Optionally choose a Review folder per account, or keep the default "Auth Review" folder.
4. If you want quieter notifications, turn off Thunderbird's built-in new-mail alert and enable "Notify for messages that pass assessment" in the add-on's settings, then choose the score limit up to which you want to be notified.

Until a trusted server is configured, authentication-based checks don't run, and the add-on will tell you so on its status panel.

### Good to know

- Setup takes a few minutes — you need to add your mail server's identifier before authentication-based checks are active.
- This isn't a replacement for your mail server's or Thunderbird's junk filtering — it's an additional, transparent layer that runs alongside it.
- The add-on never rewrites message content or headers, and never trains Thunderbird's built-in junk classifier on your behalf.
- Moving high-risk mail directly to Junk is available but off by default; by default everything goes to the Review folder for you to decide.

**Discovery terms:** spam, phishing, junk mail, email security, sender authentication, SPF, DKIM, DMARC, notifications, review folder.

---

## 日本語 (Japanese)

### 概要（短い説明、250文字以内）

迷惑メールやフィッシングの通知に悩まされていませんか。怪しいメールは自動でレビュー用フォルダーに振り分けられ、通知は設定したしきい値に応じて届く範囲を選べます。判定理由もすべて確認できます。処理はすべてお使いの端末内で完結します。

---

### 詳細説明

**Thunderbird Auth Results Filter** は、怪しい受信メールを専用の「レビュー」フォルダーへ静かに振り分けることで、受信トレイと通知を本当に大切なメールに集中させます。なぜそのメールが振り分けられたのかも、常にわかりやすく表示されます。

この拡張機能は、メールサーバー側の迷惑メール対策を置き換えるものではなく、それを補完するものです。プロバイダーがすでに行っている迷惑メール処理と並行して動作し、ユーザーが制御できる透明性の高い追加の保護層を提供します。

#### 解決すること

- **通知のノイズを自分で調整。** Thunderbird 標準の新着メール通知をオフにし、この拡張機能の通知をオプトインで有効にできます。通知が届く対象は、設定したスコアの上限によって決まります。既定の上限では安全と判断されたメールのみが対象ですが、上限を上げればレビュー対象（スコア50〜99）のメールについても通知を受け取れるよう選択できます。
- **怪しいメールをレビュー用に分離。** リスクがあると判断されたメールは受信トレイに残らず、専用の「Auth Review」フォルダーへ移動します。届いた順に対応するのではなく、都合のよいタイミングでまとめて確認できます。
- **明確で確認可能な理由。** すべてのメールについて、スコアだけでなく平易な言葉での説明が表示されます。メールを開いてポップアップを確認すれば、どの要因が影響したか、レビュー行きを回避させた保護要因も含めて確認できます。
- **簡単な訂正操作。** 正当なメールが誤って振り分けられた場合、ポップアップから受信トレイへ戻したり、送信者をホワイトリストに追加したりできます。ホワイトリスト登録には確認ステップがあり、誤操作を防ぎます。

#### 判定のしくみ

送信者の認証結果（SPF・DKIM・DMARC — メールが本当に主張どおりの送信元から届いたかを確認する仕組み）と、送信者アドレス・ドメインの特徴を組み合わせて評価します。既定の設定では、単一の弱いシグナルだけで受信トレイから移動することはなく、複数の独立したシグナルが揃って初めてレビュー対象となります。これにより、通常の転送メールやメーリングリスト、ニュースレターの誤検知を減らしています。詳細設定でこれらの副次的なシグナルの重みを調整できるため、この既定の挙動は変更可能です。

#### わかりやすい信頼モデル

この拡張機能は、**ユーザーが明示的に信頼済みとして登録したメールサーバー**の認証結果のみを採用します。自動的に信頼されるものは一切ありません。未承認のサーバーからの認証情報は確認用として記録されますが、スコアには一切影響しません。そのため、偽装によってスコアが操作されることはありません。

#### プライバシー

メールの評価、判定履歴、設定は、すべてお使いの端末内で処理・保存されます。既定の状態では、メールに関する情報がどこかへ送信されることはありません。

唯一の例外は、セットアップアシスタントの任意機能である DNS ルックアップです。これは信頼済みサーバーを設定する際の初期候補を提案するためだけに使われます。**既定では無効**であり、有効にした場合でも送信されるのはアカウントのメールドメインのみ（メール内容は送信されません）で、提案された候補は手動で追加する必要があり、自動的に信頼されることはありません。

#### セットアップ手順

1. 拡張機能のオプションページを開きます。
2. 「信頼済み認証サーバー」欄に、メールサーバーが認証結果に署名する際の識別子を追加します（セットアップアシスタントによる候補提案、または手動入力が可能です）。
3. 必要に応じてアカウントごとにレビュー用フォルダーを指定できます（既定は「Auth Review」フォルダーです）。
4. 通知を静かにしたい場合は、Thunderbird 標準の新着メール通知をオフにし、拡張機能の設定で「評価に合格したメールを通知する」を有効にした上で、通知対象とするスコアの上限を選択してください。

信頼済みサーバーが設定されるまでは認証ベースのチェックは行われず、その旨がステータスパネルに表示されます。

#### 知っておくとよいこと

- セットアップには数分かかります。認証チェックを有効にするには、まずメールサーバーの識別子を登録する必要があります。
- メールサーバーや Thunderbird 標準の迷惑メールフィルターを置き換えるものではなく、それらと並行して動作する透明性の高い追加レイヤーです。
- この拡張機能はメール本文やヘッダーを書き換えることはなく、Thunderbird 標準の迷惑メール学習機能を操作することもありません。
- 高リスクメールを直接「迷惑メール」フォルダーへ移動する機能もありますが、既定では無効です。既定ではすべてレビュー用フォルダーに振り分けられ、ユーザー自身が判断します。

**検索キーワード:** 迷惑メール, フィッシング, スパム, メールセキュリティ, 送信者認証, SPF, DKIM, DMARC, 通知, レビューフォルダー

---

## Publishing Notes (Developer Hub, listing-only update)

This is a **metadata/listing update only**. It does not require a new add-on version, a new XPI, or a manifest change. Apply it in the Thunderbird Add-ons Developer Hub as follows:

1. Sign in to the [Developer Hub](https://addons.thunderbird.net/developers/) and open the existing listing for this add-on (do not create a new version).
2. Go to the listing's **Edit Product Page** (or equivalent metadata-only) section — this is separate from uploading a new package.
3. Replace the **Summary** and **Description** fields with the English text above.
4. If the Developer Hub exposes a locale switcher for listing metadata (summary/description translations), add a **Japanese (ja)** locale entry and paste the Japanese text above into it. If the store does not support per-locale listing metadata for this add-on, keep the Japanese text in this document for future use and publish English only.
5. Update **Tags/Category** fields if prompted, using the discovery terms listed above (spam, phishing, junk mail, sender authentication, SPF, DKIM, DMARC, notifications) — avoid keyword stuffing.
6. Save/submit the listing metadata. This does not trigger add-on review the way a new package version does, but confirm the Hub doesn't queue it for content review before it goes live.
7. Verify the published listing renders correctly (including Japanese, if added) before closing out this change.
8. No changes to `src/`, `manifest.json`, or the packaged XPI are needed or should be made for this update.

---

## Screenshot Checklist

The following screenshots should be captured from a working test installation to accompany the store listing. They do not need to be final-quality artwork — clear, readable captures from a real Thunderbird session are sufficient.

### 1. Basic setup — Protection Status panel

**What to show:**
- Options page, Basic tab, Protection Status section.
- One state showing "protected" (at least one trusted server configured, recent messages assessed).
- One state showing the warning when no trusted servers are configured (optional but useful for documentation).

**Why:** First thing users see; confirms the add-on is active.

### 2. Trusted Authentication Servers settings

**What to show:**
- Options page, Basic tab, Trusted Authentication Servers section.
- At least one trusted entry visible (e.g. `mail.example.com`, match type shown).
- Setup assistant open, showing MX hint suggestions (optional).

**Why:** Communicates the required setup step and what the workflow looks like.

### 3. Review folder — message list

**What to show:**
- Thunderbird message list for the "Auth Review" folder.
- A handful of messages moved there by the add-on.

**Why:** Shows the primary action the add-on takes — moving suspicious mail out of the Inbox.

### 4. Message display popup — score details

**What to show:**
- A message open in Thunderbird with the add-on's toolbar button visible.
- The popup open, showing:
  - Classification label (e.g. "review" or "high-risk").
  - Total score.
  - Primary score reasons with labels and deltas.
  - Protective factors section (if applicable).
  - "Score details" panel expanded to show full reason list.

**Why:** The popup is the main per-message explanation surface. Users deciding whether to whitelist or investigate need to see what it looks like.

### 5. Score details with a mitigation visible

**What to show:**
- Popup open on a legitimate newsletter or mailing-list message that reached the review folder.
- Score reasons showing both a risk signal (e.g. "SPF MAIL FROM differs from From") and a mitigation (e.g. "Delegated newsletter: DKIM-aligned, route-consistent").
- Protective factors section naming the mitigation.

**Why:** Demonstrates that the add-on explains why a message was *not* treated as higher risk, which builds trust with users who encounter false positives.

### 6. Review Actions (Move to Inbox / Whitelist Sender)

**What to show:**
- Popup open on a message currently in the Auth Review folder.
- Review Actions section visible at the bottom with "Move to Inbox" and "Whitelist Sender" buttons.
- Optionally: the confirmation step for "Whitelist Sender".

**Why:** Communicates the self-service remediation workflow for false positives.

### 7. Diagnostics / Decision Log (optional)

**What to show:**
- Options page, Diagnostics tab, Decision Log section.
- A few log entries with score reasons visible, original and recalculated scores.
- Export button visible.

**Why:** Signals to power users that full diagnostic data is available and exportable without leaving Thunderbird.

### 8. Notification settings (recommended, new)

**What to show:**
- Options page, notification settings section, showing "Notify for messages that pass assessment" enabled and the accompanying caveat text about disabling Thunderbird's built-in new-mail notification.

**Why:** Makes the notification-filtering workflow — a headline benefit in the listing — visible in the actual UI.

## Screenshot capture rules (privacy)

All screenshots — for the store listing and for the README — must use synthetic
or fully redacted data. Before capturing or cropping, confirm the frame
contains no real:

- email address (use synthetic domains such as `example.com`, `example.org`,
  `example.net`, and made-up local parts);
- message subject or body content;
- account name or display name;
- folder URI or local filesystem path (e.g. profile paths in a window title
  or status bar);
- `Message-ID` or other message identifier.

Prefer a dedicated test profile with fabricated accounts and messages over
redacting a real inbox after the fact — redaction after capture is easy to
miss (e.g. a sender name inside a quoted reply, or a path in a window title).

## Image dimensions and cropping

- **Store listing screenshots** (items 1–8 above): capture at the Thunderbird
  window's native resolution, then crop to the relevant panel/popup with a
  small margin. Target **1280×800** (16:10) where the content allows it —
  this is a comfortable size for the Add-ons listing's screenshot carousel;
  a taller or shorter crop is fine when the panel's natural proportions don't
  fit 16:10 well. Export as PNG. Re-check the current upload constraints
  (max file size, accepted formats) on the Developer Hub's upload page before
  submitting, since these can change independently of this document.
- **README screenshots** (subset embedded near the top of `README.md`, see
  `assets/screenshots/`): the four current captures share a 1680×960 canvas
  and are downscaled by the Markdown table. They show the message popup,
  review-folder quick actions, trusted-server setup, and notification settings
  (store-listing items 4, 6, 2, and 8). The review-folder message list (item 3)
  is not part of this set and would need a separate capture if required for the
  store listing.

## Captions

Short captions for the four README screenshots (English, with a Japanese
equivalent):

| Screenshot | English caption | Japanese caption |
|---|---|---|
| Message popup (item 4) | See why a message was flagged: score, classification, and reasons. | 振り分けの理由を、スコアと判定結果で確認できます。 |
| Review-folder quick actions (item 6) | Move a false positive back to Inbox or whitelist its sender. | 誤検知は受信トレイへ戻すか、送信者を許可できます。 |
| Trusted authentication servers (item 2) | Choose which mail server's authentication results to trust. | 認証結果を信頼するメールサーバーを指定できます。 |
| Notification settings (item 8) | Choose which assessed messages trigger a notification. | 判定後に通知するメールの条件を設定できます。 |

For the full eight-item store listing set, a short one-line caption per image
(English only is sufficient for the Developer Hub) is enough — reuse the
"What to show" / "Why" text above as source material.

## Manual upload order (Thunderbird Add-ons Developer Hub)

Screenshots are uploaded on the same **Edit Product Page** used for the
listing-metadata update described above (this does not require a new
version). Upload in this order so the carousel tells the "what it shows me,
how I use it, how I configure it" story in sequence:

1. `01-message-popup-verdict.png` — score and reasons (item 4).
2. `02-review-folder-workflow.png` — Move to Inbox / Whitelist Sender (item 6).
3. `03-trusted-authentication-servers.png` — protection status and trusted-server setup (items 1/2).
4. `04-notification-settings.png` — notification controls (item 8).

The remaining checklist items (including the review-folder message list) need
separate captures if they are desired for the store listing. Review the first
image's visible spam subject/body against the privacy checklist before upload.

Add the caption text for each image in the Developer Hub's per-screenshot
caption field, when the upload form offers one, using the captions above (or
the "What to show" line for items without an explicit caption yet).

---

## Store Metadata Notes

- **Category:** Security / Privacy (or Filters, if that is the best-fit category on ATN).
- **License:** Mozilla Public License 2.0.
- **Homepage / Support URL:** project repository.
- **Tags to consider:** spam filter, phishing, junk mail, authentication, DMARC, SPF, DKIM, email security, notifications, review folder.

---

## Verification Checklist

Before submitting the listing:

- [ ] The first two sentences of both the English and Japanese summaries explain user value without requiring the reader to already know what `Authentication-Results` or `authserv-id` mean.
- [ ] Notification filtering (disable Thunderbird's built-in alert, add-on notifies only for messages passing the threshold) is described accurately and matches `notifyAfterAssessment` / `notificationMaxScore` behavior.
- [ ] Review-folder workflow and visible score reasons are described accurately.
- [ ] Description does not claim to block all spam or guarantee accuracy.
- [ ] Description clearly states mail data stays local (no external uploads) and names the one opt-in exception (MX lookup).
- [ ] "Supplements, does not replace, server-side/Thunderbird spam filtering" statement is present.
- [ ] Known limitations / "Good to know" section is present and honest.
- [ ] Privacy section is consistent with `PRIVACY.md`.
- [ ] Trust model explanation (trusted servers required, untrusted headers ignored for scoring) is accurate.
- [ ] Setup requirement (manual `authserv-id`/trusted-server configuration) is stated upfront.
- [ ] Discovery terms (spam, phishing, junk mail, SPF, DKIM, DMARC, sender authentication, notifications) appear naturally, without keyword stuffing.
- [ ] Japanese text is present and consistent with the English content.
- [ ] Publishing Notes section reflects the current Developer Hub steps for a listing-only update.
- [ ] All screenshots show the current UI (not an earlier design).
- [ ] The four README captures cover the verdict, review actions, trusted-server setup, and notification settings; capture the full review-folder message list separately if required for the store listing.
- [ ] No real email address, subject, body, account name, folder URI, local path, or message identifier is visible in any screenshot ("Screenshot capture rules" above).
- [ ] The four real images under `assets/screenshots/` have passed a final pixel-level privacy review (especially the visible spam subject/body in image 1) before store submission.
- [ ] Screenshots are uploaded in the order documented under "Manual upload order" above.
- [ ] No source under `src/`, manifest version, or packaged XPI changed as part of this update.
