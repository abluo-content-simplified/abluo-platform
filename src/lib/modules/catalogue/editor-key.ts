// ── Catalogue — the React key of an editor page (item, collection, option list) ──
//
// The editor owns ONE autosave engine for its draft, which carries the draft's latest revision
// and the journal of unconfirmed edits. Remounting the editor starts a second engine on the same
// draft with the revision the server rendered — while the first one is still flushing. Two
// writers then race on `ifRevisionId`: one is refused as "changed elsewhere", and anything the
// person did in the unmounted editor (e.g. the category just created inline) is dropped.
//
// A server re-render happens without any navigation: every Server Action that revalidates the
// route (inline category/tag creation → revalidatePath of the Catalogue layout) or refreshes the
// session cookie re-renders the page. Keying on the DRAFT revision (the old key) remounted the
// editor after every such re-render that followed a save (Tom's bug report 2026-11-03).
//
// So the key changes only when the document changed under the editor in a way the editor does
// not track itself: a publish (the published revision moves; the editor is meant to start over
// from what is stored then). The draft's own revision — moved by the editor's own saves, and by
// the first edit of a published document opening its draft — never remounts it.

export function catalogueEditorKey(snapshot: { id: string; live: { rev: string } | null }): string {
  return `${snapshot.id}:${snapshot.live?.rev ?? ''}`
}
