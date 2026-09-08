---
target: Portfolio account sidebar
total_score: 24
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 1
timestamp: 2026-09-08T08-19-34Z
slug: src-components-dashboard-charts-account-filter-tsx
---

Method: dual-agent (A: sidebar_design; B: sidebar_evidence)

Portfolio account sidebar critique

Design specificity: Bitcoin-specific information is useful, but generic checkbox cards and incidental wrapping undermine the account-selection task. Preserve the neutral palette and financial information; refine structure.

| Heuristic            | Score |
| -------------------- | ----- |
| System status        | 3     |
| Familiar terminology | 3     |
| User control         | 3     |
| Consistency          | 1     |
| Error prevention     | 3     |
| Recognition          | 3     |
| Efficiency           | 2     |
| Visual hierarchy     | 1     |
| Error recovery       | 3     |
| Guidance             | 2     |
| Total                | 24/40 |

Working well: useful Bitcoin/fiat amounts and shares, immediate filtering, and native labeled selection controls.

Priority issues:

1. P1: Unstable geometry. The 220/320px density-dependent width moves the charts. Wrapping creates different compositions for each account. Fix: constant sidebar width and a deterministic stacked detailed layout. Suggested command: impeccable layout.
2. P2: Weak hierarchy. Large mode control, centered All accounts, floating checkboxes and scattered metadata compete. Fix: restrained explicit density selector, left-aligned actions, checkbox anchored beside name, then account type, Bitcoin balance, fiat and share. Suggested command: impeccable polish.

Personas: power users lose their chart comparison point when toggling density; keyboard/zoom users face unpredictable selection-control placement; long-name accounts expose incidental wrapping.

Minor observations: maintain privacy boundaries around balances/shares and reconnect routes. Compact mode should change item density while preserving outer geometry.

Detector: zero findings. Browser unavailable; supplied screenshots and source are visual evidence, not a post-change browser capture.

Questions skipped: two priority issues, already authorized by the user for implementation.
