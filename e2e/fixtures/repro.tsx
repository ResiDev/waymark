import { useState } from "react";
import { createRoot } from "react-dom/client";
import { defineWalkthrough, Walkthrough } from "react-waymark";

// Minimal layout cases for scripts/repro-react.ts; all guidance uses public exports.
const scenario = new URLSearchParams(location.search).get("case");
const walkthrough = defineWalkthrough([
  scenario === "general" ? {
    content: "General guidance should follow the viewport, even without a waymark.",
  } : {
    waymark: "repro",
    scroll: "never",
    preferredPlacement: scenario === "resize" ? "right" : "below",
    content: "This instruction should stay beside the page element.",
  },
]);

function GrowingContent({ advance }: { advance: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ width: 300, height: expanded ? 300 : 40, background: "white", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <button type="button" onClick={() => setExpanded(true)}>Expand content</button>
      {expanded && <p>The child grew without changing the walkthrough or its waymark.</p>}
      {expanded && <button type="button" onClick={advance}>Finish walkthrough</button>}
    </div>
  );
}

function Reproduction() {
  const [moved, setMoved] = useState(false);
  const position = scenario === "content"
    ? { left: 400, top: 450 }
    : { left: 20, top: 20 };
  return (
    <>
      <button id="waymark" type="button" data-waymark="repro" style={position}>Page element</button>
      {scenario === "transform" && (
        <div id="controls" data-waymark-ui="">
          <button type="button" onClick={() => setMoved(true)}>Move parent</button>
        </div>
      )}
      <div id="renderer" style={{ transform: moved ? "translate(100px, 100px)" : undefined }}>
        <Walkthrough
          walkthrough={walkthrough}
          waymarkPadding={0}
          {...(scenario === "content" ? { renderPopover: ({ advance }) => <GrowingContent advance={advance} /> } : {})}
        />
      </div>
    </>
  );
}

createRoot(document.querySelector("#root")!).render(<Reproduction />);
