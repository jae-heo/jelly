// The native field owns its IME text. Only stable text is mirrored to the PTY.
const hangul = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7ff]$/u;

export function liveInputTarget(value: string, composing: boolean, compositionStart: number, commit: boolean): string {
  if (commit) return value;
  if (hangul.test(value)) return Array.from(value).slice(0, -1).join('');
  return composing ? value.slice(0, compositionStart) : value;
}

export function liveInputDelta(previous: string, next: string): string {
  const before = Array.from(previous);
  const after = Array.from(next);
  let common = 0;
  while (common < before.length && common < after.length && before[common] === after[common]) common++;
  return '\x7f'.repeat(before.length - common) + after.slice(common).join('');
}
