# Screenshot assets

These four 1680x960 PNGs are real Thunderbird captures embedded in the
project [README](../../README.md). They replace the SVG placeholder graphics.
The first image is the maintainer's final redacted version; the others are
cropped and padded captures of the review actions and Basic settings.

| File | Shows |
|---|---|
| `01-message-popup-verdict.png` | Review verdict, score, and reasons. |
| `02-review-folder-workflow.png` | Review-folder quick actions in the popup. |
| `03-trusted-authentication-servers.png` | Trusted-server setup on the Basic tab. |
| `04-notification-settings.png` | Notification controls on the Basic tab. |

Before uploading any of these to the Thunderbird Add-ons listing or merging a
public export, check the actual pixels against the privacy checklist in
[`docs/store-listing.md`](../../docs/store-listing.md#screenshot-capture-rules-privacy).
Image 1 contains a real spam message's subject and body text; its addresses
have been redacted, but the remaining text still needs maintainer approval for
public display. The images are not part of the packaged XPI. The private-to-
public source export includes `assets/` wholesale (see `PUBLIC_INCLUDE` in
`scripts/release-public.mjs`).
