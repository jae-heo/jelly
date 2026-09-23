const sequences = {
  Escape: '\x1b', Tab: '\t', Enter: '\r', Backspace: '\x7f',
  ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
  Home: '\x1b[H', End: '\x1b[F', PageUp: '\x1b[5~', PageDown: '\x1b[6~',
  Insert: '\x1b[2~', Delete: '\x1b[3~', ShiftTab: '\x1b[Z',
  F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS',
  F5: '\x1b[15~', F6: '\x1b[17~', F7: '\x1b[18~', F8: '\x1b[19~',
  F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~',
} as const;

export type TerminalKey = keyof typeof sequences;

export function terminalKeySequence(key: TerminalKey, applicationCursor: boolean): string {
  const sequence = sequences[key];
  // Match xterm's physical-key encoding when a TUI enables application cursor mode.
  if (applicationCursor && (key.startsWith('Arrow') || key === 'Home' || key === 'End')) {
    return '\x1bO' + sequence.at(-1);
  }
  return sequence;
}
