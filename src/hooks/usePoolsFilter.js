import { useState, useMemo } from "react";

export function usePoolsFilter(pools) {
  const [activeFilter, setActiveFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("TVL");

  const filtered = useMemo(() => {
    return pools
      .filter((p) => {
        const tagOK = activeFilter === "All" || p.tags.includes(activeFilter);
        const searchOK = !search || p.pair.toLowerCase().includes(search.toLowerCase());
        return tagOK && searchOK;
      })
      .sort((a, b) => {
        if (sort === "TVL") return parseFloat(b.tvlNum) - parseFloat(a.tvlNum);
        if (sort === "Volume") return parseFloat(b.volumeNum) - parseFloat(a.volumeNum);
        if (sort === "APR") return parseFloat(b.aprNum) - parseFloat(a.aprNum);
        return 0;
      });
  }, [pools, activeFilter, search, sort]);

  return {
    activeFilter,
    setActiveFilter,
    search,
    setSearch,
    sort,
    setSort,
    filtered,
  };
}
