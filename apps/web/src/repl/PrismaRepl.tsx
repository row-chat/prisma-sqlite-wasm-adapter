import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorkerUrl from 'monaco-editor/esm/vs/editor/editor.worker?worker&url';
import tsWorkerUrl from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker&url';
import { useEffect, useRef, useState } from 'react';
import replTypes from '../../../../packages/sqlite-db/prisma/repl-types.d.ts?raw';
import prisma from '../db/prisma-sqlite-client';
import './PrismaRepl.css';
import './repl.css';
import SplitPane from './SplitPane';
import { useReplHistory } from './useReplHistory';

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(tsWorkerUrl, { type: 'module' });
    }
    return new Worker(editorWorkerUrl, { type: 'module' });
  },
};

loader.config({ monaco });

export default function PrismaRepl() {
  const { history, append, clear, recallPrev, recallNext } =
    useReplHistory('prisma-repl');
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const [showPlaceholder, setShowPlaceholder] = useState(true);

  function moveCursorToEnd(editor: Parameters<OnMount>[0]) {
    const model = editor.getModel();
    if (!model) return;
    const line = model.getLineCount();
    editor.setPosition({
      lineNumber: line,
      column: model.getLineMaxColumn(line),
    });
  }

  useEffect(() => {
    const el = historyPanelRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.focus();
    editor.onDidChangeModelContent(() => {
      setShowPlaceholder(editor.getValue() === '');
    });

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      allowNonTsExtensions: true,
      strict: true,
      lib: ['esnext'],
    });

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      replTypes,
      'prisma-repl.d.ts',
    );

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      run(),
    );

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () =>
      editor.setValue(''),
    );

    const cursorAtTop = editor.createContextKey<boolean>(
      'replCursorAtTop',
      true,
    );
    const cursorAtBottom = editor.createContextKey<boolean>(
      'replCursorAtBottom',
      true,
    );
    const updateCursorKeys = () => {
      const pos = editor.getPosition();
      const model = editor.getModel();
      if (!pos || !model) return;
      cursorAtTop.set(pos.lineNumber === 1);
      cursorAtBottom.set(pos.lineNumber === model.getLineCount());
    };
    editor.onDidChangeCursorPosition(updateCursorKeys);
    editor.onDidChangeModelContent(updateCursorKeys);
    updateCursorKeys();

    editor.addAction({
      id: 'repl-history-up',
      label: 'REPL History Up',
      keybindings: [monaco.KeyCode.UpArrow],
      precondition: 'replCursorAtTop && !suggestWidgetVisible',
      run: () => {
        const recalled = recallPrev(editor.getValue());
        if (recalled === null) return;
        editor.setValue(recalled);
        moveCursorToEnd(editor);
      },
    });

    editor.addAction({
      id: 'repl-history-down',
      label: 'REPL History Down',
      keybindings: [monaco.KeyCode.DownArrow],
      precondition: 'replCursorAtBottom && !suggestWidgetVisible',
      run: () => {
        const recalled = recallNext();
        if (recalled === null) return;
        editor.setValue(recalled);
        moveCursorToEnd(editor);
      },
    });
  };

  async function run() {
    const editor = editorRef.current;
    if (!editor) return;
    const input = editor.getValue().trim();
    if (!input) return;

    let output: string;
    let isError = false;
    try {
      if (input === 'clear' || input === '/c') {
        clear();
        editor.setValue('');
        return;
      }
      const args = ['prisma'];
      const vals = [prisma];
      type ReplFn = (...vals: unknown[]) => Promise<unknown>;
      let fn: ReplFn;
      try {
        fn = new Function(
          ...args,
          `return (async () => { return ${input} })()`,
        ) as ReplFn;
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        fn = new Function(
          ...args,
          `return (async () => { ${input} })()`,
        ) as ReplFn;
      }
      const result: unknown = await fn(...vals);
      try {
        output = JSON.stringify(result, null, 2) ?? 'undefined';
      } catch {
        output = String(result);
      }
    } catch (err) {
      isError = true;
      output = err instanceof Error ? err.message : String(err);
    }

    append({ input, output, isError });
  }

  const editorPanel = (
    <div className="repl-editor">
      {showPlaceholder && (
        <div className="repl-editor-placeholder">
          prisma… — Cmd+Enter to run
        </div>
      )}
      <Editor
        height="100%"
        defaultLanguage="typescript"
        defaultValue=""
        theme="vs-dark"
        loading={null}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          wordBasedSuggestions: 'off',
          suggest: {
            showSnippets: false,
          },
          lineNumbers: 'off',
          glyphMargin: false,
          folding: false,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          fontSize: 14,
          padding: { top: 8 },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          renderLineHighlight: 'none',
          automaticLayout: true,
        }}
      />
    </div>
  );

  const historyPanel = (
    <div
      className="repl-history"
      ref={historyPanelRef}
      onKeyDown={(e) => {
        if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(historyPanelRef.current!);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }}
      tabIndex={0}
    >
      {history.map((entry, i) => (
        <div key={i} className="repl-entry">
          <div className="repl-input">&gt; {entry.input}</div>
          <pre
            className={`repl-output ${entry.isError ? 'repl-output-err' : 'repl-output-ok'}`}
          >
            {entry.output}
          </pre>
        </div>
      ))}
    </div>
  );

  return (
    <SplitPane
      left={editorPanel}
      right={historyPanel}
      storageKey="prisma-repl-split"
    />
  );
}
