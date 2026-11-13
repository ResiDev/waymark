import { act, useEffect, type ReactNode } from "react";
import { defaultBeacon, defaultPopover, useRun, WaymarkRoot, type Run, type WaymarkRootProps } from "../index";
import { addRoot } from "./dom";

/**
 * A React root whose `render` draws the page inside a `<WaymarkRoot>` with the
 * props given, drawn by the library's popover and beacon unless they say otherwise, in act, and resolves to the Run that root made, for the test to
 * drive as the app's own code would. Unmounted when the test ends.
 */
export const addWaymarkRoot = () => {
  const { root, host } = addRoot();
  let run: Run | undefined;
  function ReadRun() {
    const current = useRun();
    useEffect(() => {
      run = current;
    }, [current]);
    return null;
  }
  const render = async (page: ReactNode, props: Partial<Omit<WaymarkRootProps, "children">> = {}): Promise<Run> => {
    await act(async () =>
      root.render(
        <WaymarkRoot renderPopover={defaultPopover} renderBeacon={defaultBeacon} {...props}>
          <ReadRun />
          {page}
        </WaymarkRoot>,
      ),
    );
    if (run === undefined) throw new Error("The WaymarkRoot did not render.");
    return run;
  };
  return { root, host, render };
};
