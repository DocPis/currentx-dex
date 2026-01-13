import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import Landing from "./features/landing/Landing";
import "./index.css";

const appUrl =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_APP_URL) ||
  "https://currentx.app";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Landing
      onEnter={() => {
        window.location.href = appUrl;
      }}
    />
    <Analytics />
  </React.StrictMode>
);
