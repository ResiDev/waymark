import { onTestFinished } from "vitest";

/**
 * A page for browser tests: Waymarks "save" and "name" at the top, "footer" far below the viewport.
 * Removed, and the window scrolled back to the top, when the test ends.
 */
export const addPage = () => {
  const main = document.createElement("main");
  main.style.padding = "40px";
  main.innerHTML = `
    <button data-waymark="save" style="display:block; padding: 8px 12px">Save</button>
    <input data-waymark="name" style="display:block; margin-top: 8px; padding: 8px 12px" />
    <div style="height: 3000px"></div>
    <button data-waymark="footer" style="display:block; padding: 8px 12px">Footer</button>`;
  document.body.append(main);
  onTestFinished(() => {
    main.remove();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
};

/** The perf test's page: one "save" Waymark, kept the same so timings stay comparable across runs. */
export const addPerfPage = () => {
  const main = document.createElement("main");
  main.style.padding = "40px";
  main.innerHTML = `
    <button data-waymark="save" style="display:block; padding: 8px 12px">Save</button>
    <div style="height: 3000px"></div>`;
  document.body.append(main);
  onTestFinished(() => main.remove());
};
