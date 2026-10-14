# Telegram Mini App audio research

Checked 2026-10-14 against the official Telegram pages and primary browser documentation linked in the local source ledger. Source IDs below map to `audio-research-sources.json`.

## Findings

Telegram describes Mini Apps as JavaScript interfaces launched inside Telegram, and its developer documentation describes the client-side Mini App API and the embedded Mini App surface.[2][1] The examined Telegram pages provide no audio-specific unlock or playback contract. That is a bounded finding about these pages, not proof that every Telegram client behaves identically or that an audio API is unavailable.

**Implementation inference:** because a Mini App runs a web interface and Web Audio is a browser API, ordinary web `AudioContext` playback is a reasonable implementation path without a Telegram-specific audio API. It is not evidence of support parity across Telegram's iOS/Android clients, nor a promise that any client will allow playback at a given moment.

MDN's Web Audio best-practices guidance says browser autoplay policy can be summarized as creating or resuming an audio context from a user gesture; it describes click-triggered context creation and the suspended/running/closed states.[3] MDN's autoplay guide lists user interaction (click, tap, key press) among the conditions that can permit audible autoplay, while Chrome documents its own autoplay policy and notes Web Audio is subject to it.[4][5] These are browser-specific policies and examples, not a universal guarantee for an embedded webview.

## Engineering implications

- Do not start audio at page boot. Create the context lazily from a real click/tap/key activation; offer a later gesture retry if context resume is rejected, remains suspended, or is interrupted.[3][5]
- A `pointerdown` alone is not a sufficient cross-platform unlock contract. The UI integration should also invoke unlock from accepted pointer-up/click/key activation paths and keep the first sound best-effort.
- Pause, hidden document, death, mute, and disposal must stop scheduled music and voices. Returning to foreground must not silently resume sound without another gesture.
- Preferences and successful context resume do not guarantee physical playback. Avoid UI language that claims audio is playing until a suitable runtime check confirms it.
- Keep device validation open: manually test Telegram iOS and Android, foreground/background transitions, Bluetooth/speaker output, and mute/pause/death controls. No such physical-device validation was performed for this implementation.

## Source access and evidence notes

All five sources were retrieved by direct HTTP GET from their official page bodies (Telegram HTML and Markdown endpoint, MDN article HTML, Chrome Developers article HTML), not search-result snippets. Telegram responses were HTTP 200. The Telegram material confirmed the HTML5/JavaScript Mini App scope but did not return an audio-specific API/policy passage in the pages examined. The browser policy facts above are scoped to the cited browser documentation. Citations establish what those documents say; they do not establish behavior on every Telegram client.

## Sources

[1] https://core.telegram.org/api/bots/webapps — Telegram Mini Apps on Telegram (MTProto API)
[2] https://core.telegram.org/bots/webapps — Telegram Mini Apps (HTML5 Mini Apps)
[3] https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices — MDN Web Audio API best practices
[4] https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay — MDN autoplay guide for media and Web Audio APIs
[5] https://developer.chrome.com/blog/autoplay — Chrome autoplay policy
