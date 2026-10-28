import type { FormEvent, ReactNode } from 'react';
import { Folder, TerminalSquare } from 'lucide-react';
import { Modal } from './Modal';
import type { Project } from './api';

const FormError = ({ error }: { error: string }) => error ? <p className="form-error" role="alert">{error}</p> : null;

export function NewSessionDialog({ project, defaultName, busy, error, onSubmit, onClose }: {
  project?: Project; defaultName: string; busy: boolean; error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void;
}) {
  return <Modal title="New session" onClose={() => !busy && onClose()}>
    <form onSubmit={onSubmit}>
      <p className="dialog-description"><Folder size={15} />{project?.name}</p>
      <label htmlFor="session-name">Session name</label>
      <input id="session-name" name="name" defaultValue={defaultName} maxLength={100} required autoFocus data-autofocus />
      <p className="field-note path-note">{project?.path}</p>
      <FormError error={error} />
      <div className="dialog-actions">
        <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button primary" disabled={busy}><TerminalSquare size={16} />{busy ? 'Opening…' : 'Open session'}</button>
      </div>
    </form>
  </Modal>;
}

// Stop and delete confirmations. focusAction lets Enter confirm right away.
export function ConfirmDialog({ title, children, action, busy, error, focusAction = false, onConfirm, onClose }: {
  title: string; children: ReactNode; action: ReactNode; busy: boolean; error: string; focusAction?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return <Modal title={title} onClose={() => !busy && onClose()}>
    <p className="dialog-description">{children}</p>
    <FormError error={error} />
    <div className="dialog-actions">
      <button className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="button danger" onClick={onConfirm} disabled={busy} {...(focusAction ? { 'data-autofocus': true } : {})}>{action}</button>
    </div>
  </Modal>;
}

export function PasteDialog({ onPaste, onClose }: { onPaste: (text: string) => void; onClose: () => void }) {
  return <Modal title="Paste into terminal" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onPaste(String(new FormData(event.currentTarget).get('text') ?? '')); onClose(); }}>
      <textarea aria-label="Text to paste" name="text" className="paste-area" rows={7} required autoFocus data-autofocus />
      <div className="dialog-actions">
        <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="button primary">Send to terminal</button>
      </div>
    </form>
  </Modal>;
}

export function HelpDialog({ fullscreenAvailable, onClose }: { fullscreenAvailable: boolean; onClose: () => void }) {
  return <Modal title="Help" onClose={onClose}><dl className="help-items">
    <div><dt>Disconnect</dt><dd>Disconnects this browser. The session keeps running.</dd></div>
    <div><dt>Stop session</dt><dd>Stops the shell and its running programs.</dd></div>
    <div><dt>Switch devices</dt><dd>Opening a session disconnects the previous device.</dd></div>
    <div><dt>Switch sessions</dt><dd>⌘⇧, previous · ⌘⇧. next. Cycles through sessions in project order.</dd></div>
    <div><dt>New session</dt><dd>+ in the header, ⌘Enter or ⌘⇧Enter creates a session in the current project.</dd></div>
    <div><dt>Delete session</dt><dd>⌘⇧⌫ then Enter deletes the current session, stops its programs and opens the previous session.</dd></div>
    <div><dt>Key combination</dt><dd>⌘ button → select a key and modifiers → Send.</dd></div>
    <div><dt>Input</dt><dd>Sends as you type, after IME composition. Enter submits. Shift+Enter is passed to the app as a separate key.</dd></div>
    <div><dt>Scroll</dt><dd>Swipe the terminal to scroll. Esc returns from tmux scrollback to input.</dd></div>
    <div><dt>Copy</dt><dd>Select text lets you scroll and copy terminal output. On phones, hold text to select it. On desktop, Option-drag (Mac) or Shift-drag selects directly in the terminal.</dd></div>
    <div><dt>Paste</dt><dd>Paste into Input or the terminal. Shortcuts → Paste text lets you review text before sending.</dd></div>
    <div><dt>Font size</dt><dd>Adjust in the More menu.</dd></div>
    <div><dt>Hide browser chrome</dt><dd>{fullscreenAvailable ? 'More → Fullscreen.' : 'iPhone: Share → Add to Home Screen. Open Jelly from that icon.'}</dd></div>
  </dl></Modal>;
}
