# Change the look

## Colours

The default popover, beacon and checklist read four CSS variables, which you can set anywhere above them, such as on `:root`:

```css
:root {
  --waymark-accent: #7c3aed;
  --waymark-on-accent: #fff; /* text on the accent */
  --waymark-surface: #fff;
  --waymark-text: #1c1917;
}
```

Every other colour, such as borders and hover tints, is mixed from those four. Left unset, the accent is blue, and the surface and text follow the page's `color-scheme`. A page that sets `color-scheme: dark` on its root element gets a dark popover with nothing else to do. If your dark mode is a class instead, set the variables under that class.

The mixing uses CSS `color-mix()`, in browsers from about 2023 on. Older ones still draw the popover, beacon and checklist, but without borders, tints or the muted text colour, and the default checklist's empty circle for a todo task doesn't show.

## Text and translations

Change the default popover's text with `labels` on `<WaymarkRoot>`, and the checklist's buttons with `labels` on `<Checklist>`:

```tsx
import type { ReactNode } from "react";
import { WaymarkRoot, defaultBeacon, defaultPopover } from "react-waymark";

export function GermanGuidance({ children }: { children: ReactNode }) {
  return (
    <WaymarkRoot
      renderPopover={defaultPopover}
      renderBeacon={defaultBeacon}
      labels={{ next: "Weiter", previous: "Zurück", finish: "Fertig", stepOf: (step, count) => `${step} von ${count}` }}
    >
      {children}
    </WaymarkRoot>
  );
}
```

Every label and its default is in the [reference](api.md#labels). `<Checklist>`'s progress text ("2 of 5 done · 1 skipped"), its accessible name and its status words are English only for now, as is `ChecklistPanel`'s accessible name unless you pass it an `aria-label`. To translate those, draw the checklist yourself with [`useChecklist`](checklists.md#draw-your-own-checklist) or the [checklist parts](api.md#checklist-parts).

## Your own popover and beacon

`renderPopover` is a function from the open step to what to draw. Waymark still places it beside the waymark, shades the page and handles the keyboard:

```tsx
import type { ReactNode } from "react";
import { WaymarkRoot, defaultBeacon } from "react-waymark";

export function Guidance({ children }: { children: ReactNode }) {
  return (
    <WaymarkRoot
      renderBeacon={defaultBeacon}
      renderPopover={({ currentStep, snapshot, advance, previous, collapse }) => (
        <div className="walkthrough-card">
          <p>{currentStep.content}</p>
          {(snapshot.waymark.status === "lost" || snapshot.waymark.status === "missing") && (
            <p>Can't find this part of the page. You can still carry on.</p>
          )}
          <button onClick={previous} disabled={snapshot.stepIndex === 0}>Back</button>
          <button onClick={advance} disabled={!snapshot.canAdvance}>Next</button>
          <button onClick={collapse}>Later</button>
        </div>
      )}
    >
      {children}
    </WaymarkRoot>
  );
}
```

Telling the user when a step's waymark can't be found is up to your popover, as above. Waymark draws it inside its own wrapper, which is already the `role="dialog"`, named with the `stepOf` label, so don't add another; set `labels.stepOf` on `<WaymarkRoot>` to translate that name. `renderBeacon` works the same way for the beacon. Everything both functions receive is in the [reference](api.md#render-props). An app that never imports `defaultPopover` or `defaultBeacon` doesn't have them in its bundle, which is where the 2 kB difference in size comes from.

The defaults are plain functions, so yours can hand some steps back to them: `renderPopover={(props) => (props.currentStep.meta ? <Mine {...props} /> : defaultPopover(props))}`.

## One walkthrough that looks different

A walkthrough can carry its own `renderPopover` and `renderBeacon`, which win over the root's for that walkthrough. They see that walkthrough's steps with their exact types, so a step's `meta` is typed:

```tsx
import { defineWalkthrough } from "react-waymark";

export const whatsNew = defineWalkthrough({
  id: "whatsNew",
  steps: [{ waymark: "export", content: "Export any board as a PDF.", meta: { image: "/new/export.png" } }],
  renderPopover: ({ currentStep, advance }) => (
    <div className="announcement">
      <img src={currentStep.meta.image} alt="" />
      <p>{currentStep.content}</p>
      <button onClick={advance}>Got it</button>
    </div>
  ),
});
```

## Stacking and portals

The popover and beacons render in `document.body`, so no `overflow` or `transform` in your layout can clip them. To render them inside `<WaymarkRoot>` instead, pass `portal={false}`.

The popover sits at `z-index` 51, over the shade at 50, and beacons at 49. These are fixed, so keep anything that must sit above a walkthrough higher than 51. A step pointing into a modal with a higher `z-index`, such as one at 1300, has its popover and shade drawn under that modal.
