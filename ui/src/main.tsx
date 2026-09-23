import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TetherApp } from "./app/TetherApp";
import "./styles/theme.css";
import "./styles/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing application root");

createRoot(root).render(
  <StrictMode>
    <TetherApp />
  </StrictMode>,
);
