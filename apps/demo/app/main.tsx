import "@fontsource-variable/inter";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Guided } from "./guidance";
import "./styles.css";

createRoot(document.querySelector("#root")!).render(
  <Guided>
    <App />
  </Guided>,
);
