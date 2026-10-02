import React from 'react';

function DesignWhiteboard({ value, onChange, prompt, onClipboardAttempt }) {
  return (
    <section className="iv-design-board" aria-label="Design whiteboard">
      <div className="iv-design-board-head">
        <div>
          <span className="iv-section-kicker">Design whiteboard</span>
          <h3>Sketch your architecture</h3>
        </div>
      </div>
      {prompt && <p className="iv-design-board-prompt">{prompt}</p>}
      <textarea
        className="iv-input iv-textarea iv-practice-editor iv-practice-editor--design"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onCopy={(event) => { event.preventDefault(); onClipboardAttempt?.('copy'); }}
        onCut={(event) => { event.preventDefault(); onClipboardAttempt?.('cut'); }}
        onPaste={(event) => { event.preventDefault(); onClipboardAttempt?.('paste'); }}
        onContextMenu={(event) => { event.preventDefault(); onClipboardAttempt?.('right_click'); }}
        onKeyDown={(event) => {
          const key = event.key.toUpperCase();
          if (((event.ctrlKey || event.metaKey) && ['C', 'X', 'V'].includes(key))
            || (event.shiftKey && event.key === 'Insert')) {
            event.preventDefault();
            onClipboardAttempt?.('clipboard_shortcut');
          }
        }}
        rows={10}
        spellCheck={false}
        placeholder={`Outline components, data flow, and trade-offs. Example:
Client -> API Gateway -> Auth Service
                |-> Product Service -> Postgres
                |-> Cache (Redis)
Explain why you chose each piece and bottlenecks you'd watch.`}
      />
      <p className="iv-design-board-hint">
        Use this for system design / architecture answers. Your spoken explanation is still submitted with these notes.
      </p>
    </section>
  );
}

export default DesignWhiteboard;
