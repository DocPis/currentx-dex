import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WhitelistPage from "./features/whitelist/WhitelistPage";
import "./index.css";

const path = (window?.location?.pathname || "").toLowerCase();
const isWhitelistPage = path.includes("whitelist");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isWhitelistPage ? <WhitelistPage /> : <App />}
  </React.StrictMode>
);
