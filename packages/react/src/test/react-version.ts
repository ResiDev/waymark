import { version } from "react";
import { beforeAll, inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    /** The React major version the project says it runs on. */
    react: string;
  }
}

// A setup file: a project that meant to run on one React and loaded another fails every file, rather than passing on
// the wrong one.
beforeAll(() => {
  if (version.split(".")[0] !== inject("react")) {
    throw new Error(`This project is for React ${inject("react")}, but React ${version} loaded.`);
  }
});
