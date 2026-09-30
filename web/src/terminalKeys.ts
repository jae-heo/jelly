const sequences = {
  Escape: '\x1b', Tab: '\t', Enter: '\r', ShiftEnter: '\x1b[13;2u', Backspace: '\x7f',
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

export interface KeyModifiers { ctrl: boolean; alt: boolean; shift: boolean }
export const noModifiers: KeyModifiers = { ctrl: false, alt: false, shift: false };

// Match conventional terminal encodings. Unsupported chords stay disabled in
// the virtual keyboard rather than silently turning into an unmodified command key.
export function terminalChordSequence(key: string, modifiers: KeyModifiers, applicationCursor: boolean): string | undefined {
  const { ctrl, alt, shift } = modifiers;
  const prefix = alt ? '\x1b' : '';
  if (key === 'Space') return prefix + (ctrl ? '\0' : ' ');
  if (/^[a-z0-9]$/.test(key)) {
    if (ctrl) {
      if (/^[a-z]$/.test(key)) return prefix + String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
      const controls: Record<string, string> = { '2': '\0', '3': '\x1b', '4': '\x1c', '5': '\x1d', '6': '\x1e', '7': '\x1f', '8': '\x7f' };
      return controls[key] === undefined ? undefined : prefix + controls[key];
    }
    return prefix + (shift ? (/^[0-9]$/.test(key) ? ')!@#$%^&*('[Number(key)]! : key.toUpperCase()) : key);
  }
  if (!(key in sequences)) return undefined;
  if (!ctrl && !alt && !shift) return terminalKeySequence(key as TerminalKey, applicationCursor);
  if (key === 'Enter') return ctrl || (alt && shift) ? undefined : shift ? sequences.ShiftEnter : prefix + '\r';
  if (key === 'Tab') return ctrl ? undefined : prefix + (shift ? sequences.ShiftTab : '\t');
  if (key === 'Backspace') return prefix + (ctrl ? '\b' : '\x7f');
  if (key === 'Escape') return ctrl || shift ? undefined : prefix + '\x1b';
  const modifier = 1 + Number(shift) + 2 * Number(alt) + 4 * Number(ctrl);
  const sequence = sequences[key as keyof typeof sequences];
  if (/^\x1b\[[ABCDHF]$/.test(sequence)) return `\x1b[1;${modifier}${sequence.at(-1)}`;
  if (/^\x1bO[PQRS]$/.test(sequence)) return `\x1b[1;${modifier}${sequence.at(-1)}`;
  const tilde = /^\x1b\[(\d+)~$/.exec(sequence);
  return tilde ? `\x1b[${tilde[1]};${modifier}~` : undefined;
}
