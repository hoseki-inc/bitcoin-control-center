# PIN flow critique

A design review of PIN entry, creation and reset, as they stood on 2026-10-30 before the redesign that follows it. Score: 20/40.

Method: dual-agent (A: design review · B: detector and browser evidence)

Scope: the whole PIN flow. Setup, Save, sign-in, wrong PIN, lockout, Forgot PIN on desktop, Umbrel and StartOS, the macOS prompt, Change PIN, and the handoff into the first-run introduction.

## Design Health Score

| #         | Heuristic                       | Score     | Key issue                                                                                                     |
| --------- | ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status     | 2         | Digit feedback and countdown are good. Reset shows no status, and nothing ever says the PIN was set.          |
| 2         | Match system / real world       | 2         | "Save your PIN" has no save action. "Short wait" grows to 60 minutes. "Done" appears before anything is done. |
| 3         | User control and freedom        | 2         | No Back in setup or Change PIN. The X discards progress.                                                      |
| 4         | Consistency and standards       | 1         | Three modal recipes, three words for confirming, and no relation to onboarding.                               |
| 5         | Error prevention                | 3         | Confirm step, attempt warnings and paste cleanup are strong. "Reset PIN" explains nothing.                    |
| 6         | Recognition rather than recall  | 2         | Eye and copy have no labels. Umbrel reset steps vanish on "Done", and the command has no Copy.                |
| 7         | Flexibility and efficiency      | 3         | Password managers, paste and number pads all work. Each unlock costs about 2.3s.                              |
| 8         | Aesthetic and minimalist design | 2         | Minimal by absence rather than by composition.                                                                |
| 9         | Error recovery                  | 2         | Wrong PIN is clear. A failed reset is silent, and "Couldn't reach" gives no cause.                            |
| 10        | Help and documentation          | 1         | No help on the lock screen. Nothing explains what the PIN protects.                                           |
| **Total** |                                 | **20/40** | **Acceptable (bottom of the band)**                                                                           |

## Design Specificity Verdict

**Design review:** The engineering is authored, but the surface is generic. Swap the logo on sign-in and this could be any fintech lock screen. Nothing says Bitcoin, local or watch-only, and the product name doesn't appear. The parts with real character (the merge into a check, the padlock) are brief or invisible.

**Deterministic scan:** 0 findings in src/pin and security-settings.tsx, but that isn't a clean result. On .tsx files the detector only does regex matching, and in a control test it caught 1 of 4 issues planted in Chakra props. Onboarding also scores 0, so the scan can't explain the gap. The browser scan found nothing on any PIN screen. Its only findings were on surrounding surfaces: overused-font on Geist (a false positive, since Geist is the app's font throughout) and a stranded "it." in the Security description (security-settings.tsx:35), which the design review also flagged.

**Measured:** the empty circle outlines have 1.48:1 contrast, below the 3:1 needed for UI controls. The focus problems in issue 4 were reproduced by both passes; no detector rule covers focus.

**Visual overlays:** injection worked in a visible Chrome tab, but the PIN screens had nothing to highlight. The tab was closed when the test servers stopped, so no overlay remains.

## Overall Impression

The gap with onboarding is concrete. Onboarding has a stage: a soft glow, a floating card, one column, and text that turns in place. The PIN screens are loose elements on white, each with its own width, and the logo moves between steps. Biggest opportunity: put the whole flow on onboarding's stage. Biggest risk is not visual: the desktop reset prompt.

## What's Working

- One real input under the circles: password managers, a pasted "123-456" and phone number pads all work.
- The merge into a check: a real idea rather than a stock spinner. Keep the choreography, shorten it.
- Honest attempt copy and a calm lockout: warns before it punishes, reserves the message line so nothing jumps, and keeps Forgot PIN reachable during a wait.

## Priority Issues

### 1. [P1] Desktop reset reads like malware, and the app says nothing around it

- What: the app passes its own prompt text (desktop/src/computer-admin.ts:14), but macOS ignores it and says "Apple could not verify this script is free of malware". The elevated command is /usr/bin/true, so the warning describes nothing real. The modal explains nothing beforehand, a refusal shows no message (pin-screens.tsx:326), and on success the app vanishes and returns on a first-run-looking "Set up your PIN".
- Why it matters: for self-custody holders, entering an admin password past a malware warning is the scam pattern. A careful person clicks Don't Allow and has no other way back in.
- Fix: try a native prompt. Authorization Services through a small signed addon keeps the administrator rule; LocalAuthentication is simpler but changes the rule to "the person logged in". Neither has been tried. Replace the modal with a step in the card: "Your accounts and history stay as they are. Confirm with this computer's administrator password, then choose a new PIN." On refusal: "PIN not reset. Nothing changed." Show "Restarting…" before the app goes away, and "Your PIN was reset. Your accounts and history are as you left them." on return, which needs a one-time flag from Sentinel.
- Suggested command: /impeccable harden, /impeccable clarify
- Note: the design review rated this P0. Rated P1 here because the reset completes for anyone who accepts the prompt.

### 2. [P1] No stage, so the flow feels like a different product

- What: plain white against onboarding's glow and card. One 32px gap between everything (pin-screens.tsx:50). The logo jumps 41px between Confirm and Save. First run cuts from stark white to the gradient.
- Why it matters: this is the largest part of "not as elegant as the rest of our app".
- Fix: one shell for every PIN screen: neutral.50, yellow glow only, logo and name fixed in place, a floating 436px card (the width of the intro's left panel) with a fixed height, left-aligned text on one column, and steps that turn with onboarding's TEXT_TURN. Phones go full-bleed and top-anchored. Take the glow from #352, because main's onboarding-takeover.tsx:174-175 still paints blue and orange.
- Suggested command: /impeccable layout

### 3. [P1] Save is the least composed screen, and it ends in a visible glitch

- What: the PIN box sits 52px left of the center line, and its digits another 3px off from trailing letter-spacing. Three unrelated widths (380, 244, 200). Eye and copy have no labels. "Save your PIN" has no save action, so a literal reader may think Continue saved it. On Continue, Save and the intro dissolve through each other for about 330ms, with the PIN digits showing under the chart, because the intro's modal (z-index 1400) sits above the lock screen (1300).
- Why it matters: this is the most sensitive screen in the flow and the end of the first impression.
- Fix: title "Your PIN is set". Show the PIN in the same six slots used for entry, with labeled Show and Copy buttons below and Continue at the bottom right. Open the intro only once the lock screen has gone.
- Suggested command: /impeccable layout, /impeccable clarify

### 4. [P1] The keyboard contract breaks on a keyboard-first screen

- What: clicking the background drops focus and digits are then silently lost. Closing Forgot leaves focus on the link, so the next digit is lost. A lockout drops focus to the page, and its end pulls focus back from wherever you are. Save arrives with nothing focused or announced. The hidden username field is an invisible tab stop (pin-field.tsx:167). The countdown is announced every second, and a correct PIN announces nothing.
- Why it matters: typing is the only interaction here, so a lost digit reads as a broken app, and screen reader users get noise or silence.
- Fix: send typed digits to the input whenever no dialog is open. Return focus to it after Forgot. Announce only the start and end of a wait. Focus each new screen's title, as Bitkey's Lockup does (bitkey-connected.tsx:108-112). Take the username field out of the tab order. Use ModalHeader in Change PIN so the dialog has a name.
- Suggested command: /impeccable harden

### 5. [P2] The circles read as radio buttons, and state changes shout

- What: six 52px rings with a concentric dot, with empty outlines at 1.48:1. A typo gets a red border, red fill, red dot, red message and a shake. Success turns six discs green at once. Each unlock takes about 2.3s (1,370ms of animation, then the fade).
- Why it matters: these are the most-seen pixels in the flow, and the daily unlock is a toll.
- Fix: six neutral.100 filled slots with no stroke, 48px on desktop and 44px on phones, spanning the column. Entered: a 12px dark dot. Next: an inset 1.5px dark ring. Error: dots turn error.700 with a smaller shake. Waiting: lighter slots, no dashes. Success: merge in neutral, with only the final disc green. Aim for about 0.9s in total. Put "6 digits" in visible copy, since slots won't reach 3:1 either.
- Suggested command: /impeccable polish, /impeccable animate

## Persona Red Flags

**Jordan (first-timer, literal):** no product name or reason for the PIN on first launch. "Save your PIN" with only Continue. "Administrator password": is that my login password? "Reset PIN": will this wipe everything? A dialog titled "Confirm": confirm what?

**Sam (screen reader, keyboard):** a correct PIN announces nothing. Save arrives silently. Change PIN's dialog has no name. The setup description is skipped because the input autofocuses past it. The countdown repeats every second.

**Casey (phone, interrupted):** Forgot PIN? is 32px tall and may sit behind the keyboard (computed, not tested on a device). The Umbrel command breaks mid-word (pin-screens.tsx:290) with no Copy, and the steps vanish while you're in the terminal.

**Dana (long-term self-custody holder, derived from PRODUCT.md):** refuses the macOS prompt and has nowhere to go. The password is accepted and the app instantly disappears. The PIN goes on the clipboard and is never cleared. Nothing says what the PIN protects, and if a reset keeps the data, Dana will want that said plainly.

## Minor Observations

- Change PIN's first step plays the full green check and a 1.37s wait when nothing has changed yet.
- "Short wait" undersells it: 30 seconds doubling up to 60 minutes (service.ts:17-19), never described as growing.
- Forgot without the desktop bridge shows only a title and Cancel (pin-screens.tsx:317), a dead end.
- Three modal recipes: 320px with a centered title, 448px with a left title, 448px with a centered title.
- The StartOS key icon floats under the text in neutral.400, outside the gray-on-gray icon rule.
- At 320px the sign-in page scrolls 3px sideways inside main, with the circles 5.5px from the edge.
- 123456 is accepted without comment.
- pin-input-theme.ts looks unused.

## Questions to Consider

- If the PIN is a privacy curtain rather than encryption, why does unlocking feel like a vault door? Should the app say plainly what it protects?
- Should Save exist at all? They just typed it twice. A long random reset code would give that screen a real job and might take the OS prompt off the common path.
- If a native prompt doesn't work out, is an auditable command or a reset code more on-brand than asking holders to click through a malware warning?

## Not Verified

- Windows and Linux prompts were read from code, not run.
- Native macOS prompt options have not been tried.
- One read showed two "Enter your PIN" headings just after a lock. It never recurred in later sampled locks and the detector script was double-loaded at the time, so it is not treated as a bug.
