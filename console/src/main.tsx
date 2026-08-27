import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@truefoundry/trueforge-ui/styles.css";
import "./console.css";

import App from "./App.js";

const root = document.getElementById("root");
if (root === null) throw new Error("root element missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
