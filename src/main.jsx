// src/main.jsx

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App.jsx";
import "./index.css";

// Config globale di React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Consideriamo i dati "freschi" per 10 secondi
      staleTime: 10_000,
      // Refetch automatico in background ogni 15 secondi
      refetchInterval: 15_000,
      // NON continuare a refetchare se la finestra è in background
      refetchIntervalInBackground: false,
      // Quando torni sulla finestra → refetch immediato
      refetchOnWindowFocus: true,
      // Piccolo retry se fallisce
      retry: 2,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
