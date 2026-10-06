import { Composition, staticFile } from "remotion";
import { FPS, footageFrames, HEIGHT, INTRO, OUTRO, WIDTH, type Timeline } from "./edit";
import { Promo, type PromoProps } from "./Promo";

export function Root() {
  return (
    <Composition
      id="Waymark"
      component={Promo}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={INTRO + OUTRO}
      defaultProps={{ timeline: null } satisfies PromoProps}
      // The length follows the capture, so it is read before rendering.
      calculateMetadata={async ({ props }) => {
        const response = await fetch(staticFile("capture.json"));
        if (!response.ok) throw new Error("No capture.json. Run pnpm --filter demo record first.");
        const timeline: Timeline = await response.json();
        return { durationInFrames: INTRO + footageFrames(timeline) + OUTRO, props: { ...props, timeline } };
      }}
    />
  );
}
