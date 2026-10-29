/** Compare editable values, including hidden place/route JSON, without storing private drafts. */
export function editorDraftSnapshot(entries: Iterable<[string, FormDataEntryValue]>) {
  return JSON.stringify(Array.from(entries)
    .filter(([name, value]) => !(['routeStopQuery', 'routeStopPlace'].includes(name) && (value === '' || value === 'null')))
    .map(([name, value]) => [name, typeof value === 'string' ? value : value.name])
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)));
}
