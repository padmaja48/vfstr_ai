import React, { useRef } from 'react';

const LANGUAGE_OPTIONS = [
  { id: 'python', label: 'Python', starter: 'def solve():\n    # write your approach\n    pass\n' },
  { id: 'javascript', label: 'JavaScript', starter: 'function solve() {\n  // write your approach\n}\n' },
  { id: 'java', label: 'Java', starter: 'class Solution {\n    public void solve() {\n        // write your approach\n    }\n}\n' },
  { id: 'cpp', label: 'C++', starter: '#include <iostream>\nusing namespace std;\n\nint main() {\n    // write your approach\n    return 0;\n}\n' },
  { id: 'sql', label: 'SQL', starter: 'SELECT *\nFROM table_name\n-- continue here\n' },
];

const INDENT_UNIT_BY_LANGUAGE = {
  python: '    ',
  java: '    ',
  cpp: '    ',
  javascript: '  ',
  sql: '  ',
};

const AUTO_CLOSE_PAIRS = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
};

const isClipboardShortcut = (event) => {
  const key = event.key.toUpperCase();
  return (
    ((event.ctrlKey || event.metaKey) && ['C', 'X', 'V'].includes(key))
    || (event.shiftKey && event.key === 'Insert')
  );
};

export const detectMentionedLanguage = (text = '') => {
  const lower = String(text).toLowerCase();
  const patterns = [
    ['sql', /\bsql\b|\bmysql\b|\bpostgres|\bwrite a(?:n)?\s+sql\s+query\b|\bselect\b.+\bfrom\b/],
    ['python', /\bpython\b|\bpy\b/],
    ['javascript', /\bjavascript\b|\bjs\b|\bnode(?:\.js)?\b|\btypescript\b/],
    ['java', /\bjava\b(?!script)/],
    ['cpp', /\bc\+\+\b|\bcpp\b/],
  ];

  for (const [id, pattern] of patterns) {
    if (pattern.test(lower)) return id;
  }
  return undefined;
};

export const detectLanguageFromQuestion = (question) => {
  const text = String(question?.question || question || '').toLowerCase();
  if (!text) return 'python';
  if (/\b(sql query|write (a |an )?sql|select\b.+\bfrom\b|mysql|postgres)\b/.test(text)) return 'sql';
  if (/\b(javascript|typescript|node(?:\.js)?|react)\b/.test(text)) return 'javascript';
  if (/\bjava\b(?!script)/.test(text)) return 'java';
  if (/\b(c\+\+|cpp)\b/.test(text)) return 'cpp';
  if (/\bpython\b/.test(text)) return 'python';
  return detectMentionedLanguage(text) || 'python';
};

export const isCodingQuestion = (question) => {
  if (!question?.question) return false;
  const text = question.question.toLowerCase();
  const meta = `${question.topic || ''} ${question.resumeReference || ''} ${question.difficulty || ''}`.toLowerCase();

  const projectDiscussion =
    /\b(how did you|what (was|were) the problem|from your (resume|project)|in your .{0,40}project|pdf knowledge|blood donation|tell me about|walk me through|can you tell me|why did you|what motivated)\b/.test(text)
    || /\b(candidate overview|projects?:|skill coverage|internship)\b/.test(meta);

  const liveCodingTask =
    /\b(write a function|write code|write an? algorithm|leetcode|pseudocode|solve this|given an? array|given a string|return the|implement a function|implement an? algorithm|sql query|time complexity|space complexity)\b/.test(text)
    || (question.difficulty === 'problem-solving' && /\b(array|string|tree|graph|leetcode|algorithm|complexity)\b/.test(text));

  if (projectDiscussion && !liveCodingTask) return false;

  if (/\bcoding\b/.test(meta) && (liveCodingTask || /problem-solving|medium-hard|leetcode/.test(meta))) {
    return true;
  }

  return liveCodingTask;
};

export const isDesignQuestion = (question) => {
  if (!question?.question) return false;
  if (isCodingQuestion(question)) return false;
  const text = question.question.toLowerCase();
  const meta = `${question.topic || ''} ${question.resumeReference || ''}`.toLowerCase();

  if (/\b(explain the architecture of your|walk me through the user flow|from your (resume|project))\b/.test(text)) {
    return false;
  }

  return (
    /\bsystem design\b/.test(meta)
    || /\b(system design|how would you design|high level design|hld|lld|rate limiter|url shortener|design a scalable)\b/.test(text)
  );
};

export const languageStarter = (languageId) =>
  LANGUAGE_OPTIONS.find((option) => option.id === languageId)?.starter || LANGUAGE_OPTIONS[0].starter;

export const isLanguageStarter = (value = '') => {
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  return LANGUAGE_OPTIONS.some(
    (option) => option.starter.replace(/\s+/g, ' ').trim() === normalized,
  );
};

function LiveCodingPanel({
  language,
  onLanguageChange,
  value,
  onChange,
  prompt,
  isMobile = false,
  onSubmitCode,
  submitting = false,
  submitDisabled = false,
  isListening = false,
  onClipboardAttempt,
}) {
  const hasCode = Boolean(value.trim()) && !isLanguageStarter(value);
  const editorRef = useRef(null);
  const indentUnit = INDENT_UNIT_BY_LANGUAGE[language] || '  ';

  const updateEditor = (nextValue, selectionStart, selectionEnd = selectionStart) => {
    onChange(nextValue);
    window.requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      editorRef.current.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const handleEditorKeyDown = (event) => {
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd } = textarea;

    if (isClipboardShortcut(event)) {
      event.preventDefault();
      onClipboardAttempt?.('clipboard_shortcut');
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const firstLineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;

      if (selectionStart === selectionEnd && !event.shiftKey) {
        updateEditor(
          `${value.slice(0, selectionStart)}${indentUnit}${value.slice(selectionEnd)}`,
          selectionStart + indentUnit.length,
        );
        return;
      }

      const selectedLines = value.slice(firstLineStart, selectionEnd);
      const lines = selectedLines.split('\n');
      const nextLines = event.shiftKey
        ? lines.map((line) => line.startsWith(indentUnit) ? line.slice(indentUnit.length) : line.replace(/^ {1,4}/, ''))
        : lines.map((line) => `${indentUnit}${line}`);
      const nextValue = `${value.slice(0, firstLineStart)}${nextLines.join('\n')}${value.slice(selectionEnd)}`;
      const delta = nextLines.join('\n').length - selectedLines.length;
      updateEditor(nextValue, Math.max(firstLineStart, selectionStart + (event.shiftKey ? Math.min(0, delta) : indentUnit.length)), selectionEnd + delta);
      return;
    }

    const closingPair = AUTO_CLOSE_PAIRS[event.key];
    if (closingPair && selectionStart === selectionEnd) {
      event.preventDefault();
      if (value[selectionStart] === closingPair) {
        updateEditor(value, selectionStart + 1);
      } else {
        updateEditor(
          `${value.slice(0, selectionStart)}${event.key}${closingPair}${value.slice(selectionEnd)}`,
          selectionStart + 1,
        );
      }
      return;
    }

    if (event.key !== 'Enter') return;

    event.preventDefault();
    const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
    const lineBeforeCursor = value.slice(lineStart, selectionStart);
    const baseIndent = (lineBeforeCursor.match(/^[\t ]*/) || [''])[0].replace(/\t/g, indentUnit);
    const trimmedLine = lineBeforeCursor.trimEnd();
    const shouldIndent = /(?:[\{\[\(]|:|=>)\s*(?:\/\/.*|#.*)?$/.test(trimmedLine);
    const nextNonWhitespace = value.slice(selectionEnd).match(/^\s*([}\])])/);

    if (shouldIndent && nextNonWhitespace) {
      const insertion = `\n${baseIndent}${indentUnit}\n${baseIndent}`;
      updateEditor(
        `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`,
        selectionStart + 1 + baseIndent.length + indentUnit.length,
      );
      return;
    }

    const nextIndent = shouldIndent ? `${baseIndent}${indentUnit}` : baseIndent;
    const insertion = `\n${nextIndent}`;
    updateEditor(
      `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`,
      selectionStart + insertion.length,
    );
  };

  const handleLanguageChange = (nextLanguage) => {
    if (nextLanguage === language) return;
    if (value.trim() && !isLanguageStarter(value)) {
      const ok = window.confirm(
        'You already wrote code in this editor. Switch language anyway? Your current code will be kept (not replaced by the new starter).',
      );
      if (!ok) return;
      onLanguageChange(nextLanguage, { keepCode: true });
      return;
    }
    onLanguageChange(nextLanguage, { keepCode: false });
  };

  const submitCode = () => {
    const editorValue = editorRef.current?.value ?? value;
    onSubmitCode?.(editorValue);
  };

  return (
    <section className="iv-live-coding" aria-label="Coding workspace">
      {isMobile ? (
        <p className="iv-live-coding-mobile-note" role="status">
          Coding workspace is cramped on phones. Prefer a laptop/desktop for typing code, or dictate your approach out loud and keep this as notes.
        </p>
      ) : null}
      <div className="iv-live-coding-head">
        <div>
          <span className="iv-section-kicker">Coding workspace</span>
          <h3>Write your solution here</h3>
        </div>
        <div className="iv-live-coding-actions">
          <label className="iv-live-coding-lang">
            <span>Language</span>
            <select value={language} onChange={(event) => handleLanguageChange(event.target.value)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {prompt && <p className="iv-live-coding-prompt">{prompt}</p>}
      <textarea
        ref={editorRef}
        className="iv-input iv-textarea iv-practice-editor iv-practice-editor--code"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleEditorKeyDown}
        onCopy={(event) => { event.preventDefault(); onClipboardAttempt?.('copy'); }}
        onCut={(event) => { event.preventDefault(); onClipboardAttempt?.('cut'); }}
        onPaste={(event) => { event.preventDefault(); onClipboardAttempt?.('paste'); }}
        onContextMenu={(event) => { event.preventDefault(); onClipboardAttempt?.('right_click'); }}
        rows={10}
        spellCheck={false}
        aria-label={`${LANGUAGE_OPTIONS.find((option) => option.id === language)?.label || 'Code'} editor`}
        placeholder="Write code or pseudocode for your answer..."
      />
      <div className="iv-live-coding-submit-row">
        <p className="iv-live-coding-hint">
          No Run/Test. Type your solution, then click <strong>Submit code</strong>.
          Optional: use <strong>Start answer</strong> below to explain your approach out loud
          {isListening ? ' (recording — use Stop & submit when done)' : ''}.
        </p>
        <button
          type="button"
          className="iv-btn iv-btn--primary iv-live-coding-submit"
          disabled={submitDisabled || submitting || !hasCode}
          onClick={submitCode}
          title={hasCode ? 'Submit your code for AI review' : 'Write code before submitting'}
        >
          {submitting ? 'AI checking answer...' : 'Submit code'}
        </button>
      </div>
    </section>
  );
}

export default LiveCodingPanel;
