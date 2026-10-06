# Accessibility plan and honest status

Target: [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/), reviewed 2026-10-05. This is an engineering target, not a legal conformance certificate. Israeli website accessibility applicability and accommodations require qualified review in addition to technical checks.

Verify dashboard and extension with keyboard only: logical focus order, visible focus, no traps, headings/landmarks, descriptive controls, dialog focus containment and return, escape behavior, live status announcements and error messages tied to fields. Check table selection/cleanup preview with a screen reader. Verify loading, success, failure and undo states without relying on color. Confirm all consequential decisions remain understandable at 200% and content reflows at 320 CSS pixels. Respect reduced motion and ensure sticky elements never obscure focused controls.

Use axe on dashboard home and every `?view=` route plus dialogs; automated passes do not cover all criteria. Test 4.5:1 normal text contrast, 3:1 large text and interactive boundaries, 24x24 minimum pointer targets under WCAG exceptions, and accessible authentication without mandatory memory puzzles. Main navigation, review/approval, rules, protected senders and settings require manual keyboard and screen-reader evidence. Extension controls target at least 44px height.

Status: source uses labelled extension URL field, live status, visible focus and semantic navigation. No complete screen-reader audit or public legal accessibility statement has been signed. Release manager must receive automated evidence plus the manual matrix; missing evidence is FAIL, not an inferred pass. Publish an owned accessibility contact and describe limitations honestly before public use.
