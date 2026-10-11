# Walkthrough button

Status: proposed. Builds on [run.md](run.md): one Run per user, drawn by
`<WaymarkRoot>`, with at most one walkthrough open.

## Problem

An app that explains part of its UI on request, with an ⓘ beside a panel that
walks the user through it, writes this for every ⓘ:

```tsx
const filtersHelp = defineWalkthrough([
  { waymark: "filter-status", content: "Pick which statuses to show." },
  { waymark: "filter-owner", content: "Or narrow it to one person's work." },
  { waymark: "save-view", content: "Save the combination as a view." },
]);

function Filters() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-label="How filters work" onClick={() => setOpen(true)}>ⓘ</button>
      {open && (
        <Walkthrough
          walkthrough={filtersHelp}
          onEvent={(event) => {
            if (event.type === "finish" || event.type === "exit" || event.type === "collapse") {
              setOpen(false);
            }
          }}
        />
      )}
    </>
  );
}
```

That is too much to sprinkle through an app, and it has to know two things
that are easy to miss. The state must go back to closed when the walkthrough
ends, or the ⓘ does nothing the second time. And a click away or Escape
collapses a walkthrough to its beacon, which suits onboarding the user should
come back to but not help they asked for, so the app treats `collapse` as
closing.

Two of these open at once also fight today: both draw a shade and a popover,
both take Escape and →, and a click in one's popover is a click away for the
other. [run.md](run.md) removes that for every walkthrough, so this design no
longer has to.

## The button

```tsx
<WalkthroughButton
  aria-label="How filters work"
  id="filtersHelp"
  steps={[
    { waymark: "filter-status", content: "Pick which statuses to show." },
    { waymark: "filter-owner", content: "Or narrow it to one person's work." },
    { waymark: "save-view", content: "Save the combination as a view." },
  ]}
>
  ⓘ
</WalkthroughButton>
```

It renders a `<button>` where it is written and knows whether its walkthrough
is open. The app writes no state.

- A click calls `run.start`. A hint is never left part way through (see
  "Opening from state"), so it opens at its first step.
- A click while it is open closes it.
- Finishing, exiting, a click away and Escape close it. So does the user
  starting another walkthrough, which interrupts it.
- `active` asks for it from application state, with `run.requestStart`.

A one-step form that takes only text was considered and dropped. A popover
already does that job. A walkthrough is worth adding when it points at several
things in turn, so the button starts at a list of steps.

| Prop | |
| --- | --- |
| `id` and `steps` | The walkthrough, inline |
| `walkthrough` | Or a definition from `defineWalkthrough` |
| `active` | Asks for it from application state |
| `renderPopover` | With inline steps, its own popover |
| `aria-label` | Required |
| anything else | Passed to the `<button>` |

`labels`, `waymarkPadding`, `portal` and `onEvent` are `<WaymarkRoot>`'s now,
and every event names its walkthrough's id. There is no `renderBeacon`. A hint
exits where other walkthroughs collapse, so it never has a beacon.

### Steps

The button takes its walkthrough one of two ways:

- `walkthrough={filtersHelp}`, a definition written with `defineWalkthrough`,
  like any other. Its `dismiss` decides what a click away does. A hint should
  say `"exit"`; without it, the hint collapses to a beacon like any other
  walkthrough.
- `id` and `steps` inline. The button builds a definition from them with
  `dismiss: "exit"`.

The inline form builds its definition once, when the button mounts, and again
only if `id` changes. A definition built on each render would hand the Run a
different definition under the same id, which throws in development.

Each step's content is drawn from the latest `steps` by index, so content that
shows live data stays current while the walkthrough is open. The rest of a
step, its waymark and advance condition, stays as it was when the button
mounted.

The button takes `const TStep` and checks its steps with `ExactStep`, as
`defineWalkthrough` does, so a misspelled `delayMs` is still a type error.
Check that TypeScript infers a const type parameter from JSX props as it does
from a call.

`id` is the walkthrough's key in the Run's record, so it must not change
between releases. Two buttons that show the same walkthrough pass the same
definition, which is fine; two different definitions under one id throw.

### Opening from state

```tsx
<WalkthroughButton
  aria-label="How filters work"
  active={filtersOpen}
  id="filtersHelp"
  steps={[…]}
>
  ⓘ
</WalkthroughButton>
```

`active` calls `run.requestStart` when it turns true, and when the button
mounts with it already true. So it waits until no other walkthrough is open,
and does nothing if the user has finished or closed this one. A click opens it
whatever its progress says, since a click calls `run.start`. `active` staying
true after the user closes the walkthrough does not open it again.

`active` needs no storage. The Run always keeps progress, so a hint the user
closed stays closed for the visit. With storage on `<WaymarkRoot>`, it stays
closed across visits too.

A hint the user was in when the page reloaded opens again at the same step,
once the button mounts, if nothing else is open. If something is, it exits, as
[run.md](run.md) sets aside any restored walkthrough that can't reopen. Either
way, a hint that isn't open is never part way through, and its ⓘ starts it at
step 1.

### Accessibility

- `aria-label` is required by the type. Nearly every one of these buttons is
  an icon, and a screen reader reads "ⓘ" as "circled latin small letter i". A
  button with text repeats its text.
- The button sets `aria-expanded`, `aria-haspopup="dialog"`, and
  `data-state="open"` or `"closed"` for styling, as `ChecklistTrigger` does.
- It carries `data-waymark-ui`, so a click on it is not a click away from its
  own walkthrough. Without it, a click on an open button would exit the
  walkthrough as a click away, and the button's handler would then open it
  again.
- The popover does not take focus, but Tab moves into it, through
  `cycleFocus` in `input.ts`. If focus is inside the popover when the
  walkthrough closes, the button takes it back, so a keyboard user who presses
  Finish is not left on `<body>`.

## Dismissing

A click away or Escape collapses a walkthrough to its beacon. That suits
onboarding, which the user should come back to. It does not suit help the user
asked for, or any walkthrough an app would rather end than leave a beacon on
the page.

A new option on `defineWalkthrough`, `dismiss`, says what a click away, Escape
and being interrupted do to it:

- `"collapse"`, the default and today's behaviour. The walkthrough hides its
  popover behind a beacon and keeps its place.
- `"exit"`. The walkthrough ends, as the × button ends it, and fires `exit` in
  place of `collapse`. Interrupted, it fires `interrupt`, as any interrupted
  walkthrough does.

It only changes what happens when the user turns away. An explicit `collapse`,
such as a "Later" button drawn with `renderPopover`, still collapses, and ×
still exits.

### Where it is set

On the walkthrough's definition, beside its steps and `maxAge`, where the rest
of how a walkthrough behaves is set:

```ts
const filtersHelp = defineWalkthrough({
  id: "filtersHelp",
  steps,
  dismiss: "exit",
});
```

The Run reads it from there. A task's walkthrough can set it too, since a task
takes the same kind of walkthrough as everything else. A task given a plain
array of steps collapses, as today.

```ts
defineChecklists({
  tasks: {
    invite: {
      title: "Invite a teammate",
      walkthrough: defineWalkthrough({ id: "invite", steps: inviteSteps, dismiss: "exit" }),
    },
  },
});
```

`defineWalkthrough` takes one object, so `dismiss` is one more optional field.
The fourth form of `defineWalkthrough` this section used to need is gone.

### What exiting does

- The walkthrough's progress records `exited`, saved if the Run has storage.
  `requestStart` won't bring it back; `start` will, at step 1. With `"exit"`,
  one stray click ends a stored onboarding walkthrough until the user starts
  it again or the app resets it. That is what exit means, and the README
  should say so beside the option.
- A task's walkthrough that exits leaves the task todo and fires
  `taskStopped` with `reason: "stopped"`. Started again from its checklist, it
  begins at its first step, where a collapsed one would have resumed from its
  beacon.
- An interrupted walkthrough does what its `dismiss` says. A task whose
  walkthrough says `"exit"` stops when the user opens a hint over it, and does
  not come back when the hint closes.
- The button's walkthrough exits, and the button closes.

### Code

`rules.ts` collapses a walkthrough on a click away (`message.hit === "away"`),
and `keyAction` in `input.ts` returns `"collapse"` for Escape. The Run reads
`dismiss` from the definition, the click rule acts on it, and `keyAction` reads
it from its input context. Interrupting a walkthrough and restoring one that
can't reopen go through the same rule.

## Not doing

- A one-step form that takes only text. A popover does that.
- Hotspots, a dot Waymark places on an element. They suit announcing
  something new, and a checklist covers that.
- Finding a step's waymark nearest the button. An ⓘ inside a component drawn
  many times would point every step at the first match on the page. Core
  already takes a `root` to search within, which React fixes to `document`,
  so this can come when an app needs it.
- Triggers that are not a button, such as a menu item, a command palette
  entry or a shortcut. They call `run.start` themselves.
- A `dismiss` for every task at once. Onboarding wants the default, collapse,
  and a task that should exit defines its walkthrough with it.

## Open questions

- A hint whose waymark was renamed still opens, with its popover centred once
  the waymark counts as missing, and nothing reports it, as `waymarkMissing`
  passes quietly by default. A warning in development would catch it, but the
  button would then differ from the defaults in `problems.md`.
- The name. `WalkthroughButton` follows `ChecklistTrigger`.
- `dismiss` or `onClickAway`. The idea started as `onClickAway`, but the
  option also decides Escape and interruption, and an option starting with
  `on` reads as a callback, as `onEvent` and `onChange` are.

## Code changes

- Core: `dismiss` on `Walkthrough`, read by the Run for a click away, Escape,
  interruption and a restore that can't reopen.
- React: `WalkthroughButton`, exported. It takes `walkthrough`, or `id` and
  `steps`, from which it builds a definition once. A click calls `run.start`,
  `active` calls `run.requestStart`, and it reads the Run's snapshot to know
  whether its walkthrough is open.
- `CONTEXT.md`: "Collapsed run" says a click away collapses a run, which now
  holds unless its walkthrough says to exit.
- README: a section on the button. "What the user can do" and the paragraph
  on `data-waymark-ui` say a click away collapses. Both mention `dismiss`, and
  that an exit is stored.
- Tests: the button toggling; a click on a closed hint opening it at step 1;
  `active` not opening a hint the user closed, with and without storage; a
  hint reopening after a reload when nothing else is open, and exiting when
  something is; inline `steps` re-rendering without throwing, with content
  staying current; and focus going back to the button. For `dismiss: "exit"`,
  a click away and Escape exiting and recording `exited`, a task's walkthrough
  exiting with the task left todo, an interrupted hint firing `interrupt`, and
  an explicit `collapse` still collapsing.
