// Structural type of the input actions the conversation standard kit exposes.
// Spelled here (not imported from ui-conversation) so this package carries no
// value or type dependency on that package's module row: the framework injects
// `inputActions` into every session-scope slot component, and the controller
// only needs the two write verbs.

/** The draft-write path of the composer (subset of the standard kit face). */
export interface InputActions {
  setDraft(text: string): void
  submit(): void
}
