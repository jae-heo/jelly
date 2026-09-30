import { useEffect, useState } from 'react';
import { ClipboardPaste, Send } from 'lucide-react';
import { noModifiers, terminalChordSequence, type KeyModifiers } from './terminalKeys';

interface Props { enabled: boolean; onSend: (key: string, modifiers: KeyModifiers) => void; onPaste: () => void }
const letterRows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const navigation = ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'];
const labels: Record<string, string> = { Escape: 'Esc', Backspace: '⌫', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn', Space: 'Space' };
const names: Record<string, string> = { ArrowLeft: 'Left arrow', ArrowUp: 'Up arrow', ArrowDown: 'Down arrow', ArrowRight: 'Right arrow', PageUp: 'Page Up', PageDown: 'Page Down', Escape: 'Esc' };

export function VirtualKeyboard({ enabled, onSend, onPaste }: Props) {
  const [group, setGroup] = useState('letters');
  const [key, setKey] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState(noModifiers);
  const clear = () => { setKey(null); setModifiers(noModifiers); };
  useEffect(() => { if (!enabled) clear(); }, [enabled]);
  const valid = key !== null && terminalChordSequence(key, modifiers, false) !== undefined;
  const preview = [...(modifiers.ctrl ? ['Ctrl'] : []), ...(modifiers.alt ? ['Alt'] : []), ...(modifiers.shift ? ['Shift'] : []), ...(key ? [key.length === 1 ? key.toUpperCase() : labels[key] ?? key] : [])].join(' + ');
  const button = (value: string) => <button key={value} type="button" className="virtual-key" disabled={!enabled} aria-label={names[value] ?? (value.length === 1 ? value.toUpperCase() : value)}
    aria-pressed={key === value} onClick={() => setKey(value)}>{value.length === 1 ? value.toUpperCase() : labels[value] ?? value}</button>;
  return <section id="terminal-virtual-keyboard" className="virtual-keyboard" aria-label="Virtual keyboard">
    <div className="virtual-heading">
      <div className="dock-key-groups" role="group" aria-label="Key groups">
        {[['letters', 'Letters'], ['navigation', 'Navigate'], ['function', 'F1–F12']].map(([value, label]) => <button key={value} type="button" aria-pressed={group === value} onClick={() => setGroup(value!)}>{label}</button>)}
      </div>
      <button type="button" className="dock-toggle" aria-label="Paste text" disabled={!enabled} onClick={onPaste}><ClipboardPaste size={17} /></button>
    </div>
    <div className="virtual-keys">
      <div className="virtual-row">{['Escape', 'Tab', 'Enter', 'Backspace', 'Space'].map(button)}</div>
      {group === 'letters' && letterRows.map(row => <div key={row} className="virtual-row">{Array.from(row).map(button)}</div>)}
      {group === 'navigation' && <div className="virtual-grid">{navigation.map(button)}</div>}
      {group === 'function' && <div className="virtual-grid">{Array.from({ length: 12 }, (_, i) => `F${i + 1}`).map(button)}</div>}
    </div>
    <div className="virtual-modifiers" role="group" aria-label="Modifiers">
      {(['ctrl', 'alt', 'shift'] as const).map(value => <button key={value} type="button" className="virtual-key" disabled={!enabled} aria-pressed={modifiers[value]}
        onClick={() => setModifiers(previous => ({ ...previous, [value]: !previous[value] }))}>{value[0]!.toUpperCase() + value.slice(1)}</button>)}
      <button type="button" className="text-button" onClick={clear} disabled={!key && !Object.values(modifiers).some(Boolean)}>Clear</button>
    </div>
    <div className="virtual-send-row">
      <output aria-label="Selected key combination">{key && !valid ? 'Unsupported key combination' : preview || 'Select a key'}</output>
      <button type="button" className="button primary" aria-label="Send key combination" disabled={!enabled || !valid} onClick={() => { if (key && valid) { onSend(key, modifiers); clear(); } }}><Send size={14} />Send</button>
    </div>
  </section>;
}
