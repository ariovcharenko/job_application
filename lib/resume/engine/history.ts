// The editor's undo stack. A new resume from "Start over" goes on top of the one she had (it used
// to clear the stack, so the edited resume was gone for good); her first draft has nothing below it.

export function historyAfterStartOver<T>(history: T[], current: T | null): T[] {
  return current ? [...history, current] : history;
}
