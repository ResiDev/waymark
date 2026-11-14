# Accessibility and the keyboard

- The popover is a `role="dialog"` named for its step, such as "Step 1 of 2". Opening it doesn't move focus, so a user typing in a field keeps their place; Tab reaches it.
- Each step draws a new popover, so after Next or Previous, focus returns to the page, and Tab brings it back.
- Nothing is announced: a screen reader isn't told when a popover opens or a step moves on by itself.
- The waymark gets `aria-haspopup="dialog"` and `aria-expanded` while its step is open.
- The default beacon is a button named "Resume walkthrough", followed by the step's title when it's a string. Its pulse stops when the user prefers reduced motion.
- The default checklist's checkboxes are named by their task's title, with each task's status in text for screen readers.

## Keys and clicks while a walkthrough is open

Next and Previous have the right and left arrow keys, and Escape puts the walkthrough aside. Tab moves only between the popover and the waymark. While a walkthrough is open, Waymark takes these keys and clicks page-wide:

- **Escape and the arrow keys.** Escape works even while the user is typing in a field; the arrow keys don't, so the user can move the text cursor. A widget of yours that uses them, such as tabs or a menu, should call `event.preventDefault()`, and Waymark leaves the key alone. The right arrow always means Next, even on right-to-left pages.
- **Clicks aren't blocked.** The shade is only drawn: a click outside the popover and waymark puts the walkthrough aside, and also does whatever it would have done.
- **Your own UI can opt out.** Inside an element marked `data-waymark-ui`, clicks don't count as clicking away and keys are left alone. See [help-menu walkthroughs](walkthroughs.md#help-menu-walkthroughs-dismiss-exit).
