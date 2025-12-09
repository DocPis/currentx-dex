// src/components/Tabs.jsx

export default function Tabs({ active, onChange }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "swap", label: "Swap" },
    { id: "liquidity", label: "Liquidity" },
  ];

  return (
    <div className="pt-4">
      <div className="inline-flex rounded-full border border-slate-700 bg-slate-900/80 p-1 text-xs text-slate-400">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`rounded-full px-3 py-1 transition ${
              active === tab.id
                ? "bg-slate-800 text-slate-100 shadow-sm shadow-black/40"
                : "hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
