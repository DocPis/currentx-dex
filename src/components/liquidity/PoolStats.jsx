// src/components/liquidity/PoolStats.jsx

export default function PoolStats({
  volumeText,
  feesText,
  tvlText,
  aprText,
}) {
  return (
    <>
      <div className="w-[14%] text-right hidden sm:block text-slate-200">
        {volumeText}
      </div>

      <div className="w-[14%] text-right hidden sm:block text-slate-200">
        {feesText}
      </div>

      <div className="w-[14%] text-right text-slate-100">
        {tvlText}
      </div>

      <div className="w-[12%] text-right text-emerald-300 font-medium">
        {aprText}
      </div>
    </>
  );
}
