import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardImage, PageHeader, PendingCard, SerialPill } from "@/components/injector/ui";
import { LevelBadge } from "@/components/injector/progress";
import { QuarantineButton, StaleBadges } from "@/components/injector/flags";
import { qk, useMe } from "@/hooks/useInjector";
import { apiGet } from "@/lib/api";
import type { CatalogItem } from "@/lib/types";

const GROUPS_PER_PAGE = 24;

const LEVEL_FILTERS: Record<string, { label: string; test: (i: CatalogItem) => boolean }> = {
  all: { label: "All levels", test: () => true },
  confirmed_70: { label: "Confirmed level 70", test: (i) => i.level_status === "confirmed_70" },
  outdated: { label: "Likely outdated", test: (i) => i.level_status === "outdated" },
  possible_misread: { label: "Possible OCR misread", test: (i) => i.level_status === "possible_misread" },
  unreadable: { label: "Level unreadable", test: (i) => i.level_status === "unreadable" },
  refresh: { label: "Needs level-70 refresh", test: (i) => i.needs_level70_refresh },
  unchecked: { label: "Not OCR-checked", test: (i) => !i.level_status },
  stale: { label: "Stale: below / unverified LV70", test: (i) => i.stale_reasons.includes("below_70") },
  quarantined: { label: "Quarantined", test: (i) => i.quarantined },
};
const LINK_FILTERS: Record<string, { label: string; test: (i: CatalogItem) => boolean }> = {
  all: { label: "Any website link", test: () => true },
  linked: { label: "Linked to website", test: (i) => Boolean(i.site_item_id) },
  unlinked: { label: "Needs website link", test: (i) => !i.site_item_id },
  exact_serial: { label: "Linked by exact serial", test: (i) => i.site_link_method === "exact_serial" },
  manual: { label: "Linked manually / bulk", test: (i) => i.site_link_method === "manual" || i.site_link_method === "bulk" },
};

export default function Gallery() {
  const { data: items = [], isLoading, isError } = useQuery({ queryKey: qk.catalog, queryFn: () => apiGet<CatalogItem[]>("/catalog") });
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(GROUPS_PER_PAGE);
  const [level, setLevel] = useState("all");
  const [link, setLink] = useState("all");
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = items.filter((i) => LEVEL_FILTERS[level].test(i) && LINK_FILTERS[link].test(i) &&
      (!s || [i.name, i.serial, i.item_key, i.item_type, i.manufacturer, i.site_item_name].some((v) => (v ?? "").toLowerCase().includes(s))));
    const map = new Map<string, CatalogItem[]>();
    for (const i of hit) map.set(i.name, [...(map.get(i.name) ?? []), i]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, q, level, link]);
  const cards = items.filter((i) => i.card_state === "card").length;
  const shown = groups.reduce((a, [, l]) => a + l.length, 0);
  const count = (f: (i: CatalogItem) => boolean) => items.filter(f).length;

  return (
    <div>
      <PageHeader kicker="Library" title="Card gallery" />
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setLimit(GROUPS_PER_PAGE); }} placeholder="Search name, serial, itemKey, type, website item" className="sm:max-w-sm" data-testid="gallery-search-input" />
          <Select value={level} onValueChange={(v: string) => { setLevel(v); setLimit(GROUPS_PER_PAGE); }}>
            <SelectTrigger className="sm:w-60" data-testid="gallery-level-filter"><SelectValue>{(v) => `${LEVEL_FILTERS[v as string]?.label} (${count(LEVEL_FILTERS[v as string]?.test ?? (() => true))})`}</SelectValue></SelectTrigger>
            <SelectContent>{Object.entries(LEVEL_FILTERS).map(([k, f]) => <SelectItem key={k} value={k} data-testid={`gallery-level-option-${k}`}>{f.label} ({count(f.test)})</SelectItem>)}</SelectContent>
          </Select>
          <Select value={link} onValueChange={(v: string) => { setLink(v); setLimit(GROUPS_PER_PAGE); }}>
            <SelectTrigger className="sm:w-60" data-testid="gallery-link-filter"><SelectValue>{(v) => `${LINK_FILTERS[v as string]?.label} (${count(LINK_FILTERS[v as string]?.test ?? (() => true))})`}</SelectValue></SelectTrigger>
            <SelectContent>{Object.entries(LINK_FILTERS).map(([k, f]) => <SelectItem key={k} value={k} data-testid={`gallery-link-option-${k}`}>{f.label} ({count(f.test)})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="font-mono text-xs text-zinc-400" data-testid="gallery-summary">{shown} shown · {cards} cards · {items.length - cards} pending · {groups.length} name groups</div>
      </div>
      {isError && <p className="text-sm text-red-300" data-testid="gallery-load-error">Could not load the library.</p>}
      {isLoading && <p className="font-mono text-xs text-zinc-400">Loading library…</p>}
      <div className="space-y-6">
        {groups.slice(0, limit).map(([name, list]) => (
          <section key={name} data-testid={`gallery-group-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            <div className="mb-2 flex items-baseline gap-3 border-b border-steel pb-1.5">
              <h2 className="font-heading text-lg font-black uppercase text-white">{name}</h2>
              <span className="font-mono text-[11px] text-gold">{list.length} {list.length === 1 ? "roll" : "separate rolls"}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {list.map((i) => (
                <div key={i.id} className="rounded-sm border border-steel bg-panel p-1.5 transition-transform duration-200 hover:-translate-y-0.5" data-testid={`gallery-card-${i.id}`}>
                  {i.card_state === "card" ? <CardImage imageId={i.card_image_id} alt={i.name} /> : <PendingCard name={i.name} serial={i.serial} rarity={i.rarity} kind={i.item_type} published={i.card_state === "pending_placeholder"} />}
                  <SerialPill serial={i.serial} className="mt-1.5 w-full" />
                  <div className="mt-1 flex flex-wrap gap-1">
                    {i.level_status && <LevelBadge status={i.level_status} />}
                    {i.site_item_id && <span className="truncate rounded-sm bg-teal/10 px-1 font-mono text-[9px] text-teal" title={`${i.site_item_name} · ${i.site_link_method}`} data-testid={`gallery-link-${i.id}`}>↗ {i.site_item_name || i.site_item_id}</span>}
                    <StaleBadges item={i} />
                  </div>
                  {isAdmin && <QuarantineButton item={i} />}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {groups.length > limit && (
        <div className="mt-6 flex justify-center"><Button variant="outline" data-testid="gallery-show-more" onClick={() => setLimit((l) => l + GROUPS_PER_PAGE * 2)}>Show more ({groups.length - limit} groups left)</Button></div>
      )}
    </div>
  );
}
