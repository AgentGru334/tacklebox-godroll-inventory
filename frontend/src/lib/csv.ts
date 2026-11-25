/** Hands a CSV to the browser as a download. Values are quoted; embedded quotes are doubled. */
export function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
