# ExamList editor local patches

The application uses `examlist-template-editor-1.1.13-examcheck.22.tgz`.

- `examcheck.1.patch` preserves data-tag formatting when native text formatting replaces token nodes.
- `examcheck.2.patch` applies on top of `examcheck.1`: HTML normalization updates the current history entry, and text/token formatting stages produce one undo entry per user command. It also passes runtime state to the formatting controller. The `.2` archive includes both patches; its package version is `1.1.13-examcheck.2`.
- `examcheck.3.patch` applies on top of `examcheck.2`: overflow measurement scans each sibling list once to identify trailing empty paragraphs. The previous recursive suffix checks required exponential work and froze the editor after enlarging a 1-column, 20-row candidate block. Measurement-local caches preserve correctness after subsequent edits. The `.3` archive includes all three patches.
- `examcheck.4.patch` applies on top of `examcheck.3`: caret-host lookup skips temporary flow spacers instead of inserting a blank paragraph on every resize move. Blank-tail deletion preserves the grid and its flow reservation, stale grid highlights no longer take precedence over text selection, and identical canonical history entries are coalesced. DOM exports and bundled/extension implementations are kept in sync.

- `examcheck.5.patch` applies on top of `examcheck.4`: table preparation preserves dimensions when the candidate block host has no measurable layout. Detached HTML clones previously returned zero host dimensions and clamped tables, columns, and rows to one pixel during apply/save/reload.

- `examcheck.6.patch` applies on top of `examcheck.5`: candidate data blocks default to 1 column, 20 rows, and zero horizontal/vertical spacing in both core and editor controls. Explicit saved settings remain authoritative.

- `examcheck.7.patch` applies on top of `examcheck.6`: empty blocks are hidden by default. Normalization preserves explicit true/false settings, including string values, in both implementations.

- `examcheck.8.patch` applies on top of `examcheck.7`: modal sizing accepts original content dimensions from `--template-candidate-block-editor-width/height` when canvas presentation removes border reservations. The application supplies these properties outside saved HTML so repeated modal openings retain the same logical size and table scale.

- `examcheck.9.patch` applies on top of `examcheck.8`: Shift cell-edge resizing uses the actual modal scale for column/row measurements rather than the old 120% threshold heuristic. The application also recovers missing grid settings from existing markup and persists control changes into the current template value instead of an obsolete page snapshot.

- `examcheck.10.patch` applies on top of `examcheck.9`: selected table objects support native clipboard copy/paste with HTML and plain text. Pasting preserves merged cells, column/row sizes, data-tag styles and inherited text appearance, removes object selection/position metadata, and uses the normal insertion/history pipeline. Candidate blocks keep authored table presentation and report insufficient space instead of shrinking it. The application displays paste errors as a toast. The sanitizer retains the clipboard marker and safe font/geometry styles.

- `examcheck.11.patch` applies on top of `examcheck.10`: capture selected-table copy at the owner document, since browsers may dispatch the event outside the editing root when an object has no text range. Require focus ownership, allow selected-table handles, and emit a copy notification. The application confirms table copies with a toast. Regression coverage includes actual clipboard replacement and copying from the data tab to the column-name tab.

- `examcheck.12.patch` applies on top of `examcheck.11`: Delete/Backspace clears selected table cells before whole-object deletion. It preserves table geometry, cell styles and spans, resets stale object/text ranges, and uses the existing modal synchronization and undo history. Cell selection is scoped to the active editor and does not intercept form inputs. Browser regressions cover partial/whole selections, merged cells and tags, modal apply/reopen, undo/redo, and explicit table-object deletion.

- `examcheck.13.patch` applies on top of `examcheck.12`: runtime overflow checks reuse the shared document measurement used by save validation, so trailing caret paragraphs after a bottom-aligned table do not trigger false warnings. Empty formatting wrappers and invisible caret characters are ignored; actual text, tokens, images, and overflowing tables remain measurable. Tests cover both runtime and public overflow state.

- `examcheck.14.patch` applies on top of `examcheck.13`: preserve the live DOM selection across runtime HTML canonicalization. Bookmarks omit temporary flow spacers and overlays, verify text nodes before restoring, retain selection direction, and refresh saved ranges so the next keystroke stays at the editing position. Browser coverage includes continuous typing, backspace, table cells, text after atomic tags, Korean IME composition, and line breaks.

- `examcheck.15.patch` applies on top of `examcheck.14`: track the active IME composition session, cancel the prior syllable's deferred sync when a new composition starts, and prevent runtime sync/keyboard commands from replacing the composing DOM. Deferred callbacks verify the current surface and are disposed with the editor. Deterministic timer tests and real Chromium composition tests type 작성자 continuously in paragraphs and table cells.

- `examcheck.16.patch` applies on top of `examcheck.15`: inserting an inline data tag consumes the single placeholder BR in an otherwise empty paragraph or table cell, preserving formatting wrappers. Actual text, objects, multi-line spacing and non-collapsed selections are untouched. Tests cover empty/formatted paragraphs, table cells, intentional breaks and same-line typing after tag insertion.

To rebuild the latest version, unpack the `.21` archive, apply the `.22` patch, update `package.json` to `1.1.13-examcheck.22`, and run `npm pack --ignore-scripts`. The published archive already contains the built runtime files, so the source repository's build scripts are not included. Update both application dependency references and the root lockfile when introducing a new archive version.

- `examcheck.22.patch` applies on top of `examcheck.21`: preserve each generated object's data source during runtime decoration and resolve preview values using that source (flat or nested data). Existing objects without a source retain the configured default. ExamCheck's shared barcode picker follows ExamList's grouped data selection, supports cancellation, and inserts at the document or data-block cursor through the command dispatcher.

Regression coverage: `template-editor-history.integration.test.ts` checks undo/redo after canonicalization; `e2e/template-editor.spec.ts` covers line alignment and mixed text/tag formatting with keyboard undo/redo in Chromium. Explicit-line alignment is implemented in the application's `template-line-alignment.ts`.

`template-document-overflow.test.ts` checks bounded work for long runs of empty paragraphs, actual overflow detection, and remeasurement after edits. The 1-column/20-row browser regression in `e2e/template-editor.spec.ts` enlarges the block through its bottom-center handle, then verifies responsive editing and preserved content.

Browser tests also verify that resize does not add paragraphs, and that Backspace/Delete on a selected blank tail retain the grid and support undo/redo. Application mount compatibility compacts the previously accumulated plain blank tail after the last grid, preserving one editable line and all actual content.

`template-table-size.integration.test.ts` checks table/column/row dimensions across repeated HTML round trips without layout. Browser regressions cover insertion, applying, reopening, and reapplying tables in 2-row and 20-row data blocks, with API writes blocked.

The table apply/reopen browser regressions use fresh templates and verify both stored table dimensions and modal/table rendered geometry over three reopen cycles for 2-row and 20-row grids.

Clipboard regressions: `template-table-clipboard.integration.test.ts` checks field isolation and sanitization; `e2e/template-clipboard.spec.ts` checks real Ctrl+C/V, undo/redo, source preservation, merged cells, data-tag styles, modal round trips and insufficient-space feedback, without database writes.

- `examcheck.17.patch` applies on top of `examcheck.16`: the runtime surface establishes its paper/document CSS classes before initializing HTML, flow spacers, and undo history. Previously application enhancements applied those classes after the initial layout calculation, changing the absolute-position containing block and shifting a saved footer table from 1008px to 1043px. Browser regressions exercise both zero-margin and ordinary empty paragraphs before a bottom-aligned table across repeated save/reload cycles, without database writes.

- `examcheck.18.patch` applies on top of `examcheck.17`: empty-document boundary protection preserves only the final caret line. Multiple empty paragraphs, nested alignment wrappers and repeated BRs retain their selection and use native Backspace/Delete, instead of being treated as one protected empty document. The document wrapper and paper settings remain intact, with normal undo/redo and typing after deletion. Regression coverage includes the blank structure left in a copied photo register.

- `examcheck.19.patch` applies on top of `examcheck.18`: font-size changes convert fixed line heights into font-relative heights using the original paragraph spacing. Snapshots survive DOM normalization, and font-sized inline runs evaluate their line height against their own font size instead of inheriting the parent's computed pixels. Later line-spacing changes update those inline runs as well. Browser regressions cover ordinary/aligned paragraphs, table lines, mixed text/data tags, custom spacing, resizing back to 11pt, single-step undo/redo and save/reload.

- `examcheck.20.patch` applies on top of `examcheck.19`: distributed alignment includes the last line with `text-align-last: justify` and character distribution. The sanitizer preserves these properties through synchronization and save/reload; token and table-cell commands reset them when switching to another alignment. The application's line-alignment handler applies the same behavior to selected explicit lines. Browser regressions measure actual text width and position for single-line paragraphs, BR-separated lines, table paragraphs and selected cells, including undo/redo and save/reload.

- `examcheck.21.patch` applies on top of `examcheck.20`: passes each token occurrence's formatValue and formatType to the host display callback, so canvas samples use the saved date/time pattern. Datetime definitions also receive the format-support marker. ExamCheck reuses ExamList presets and token validation, adds printed-at datetime patterns, and applies the same formatter to canvas and PDF output. Browser coverage verifies per-occurrence edits, custom validation, reset/cancel, undo/redo, save/reload, and print preview.
