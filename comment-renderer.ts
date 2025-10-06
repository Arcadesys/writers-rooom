import { StateEffect, StateField, EditorState, type Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { WriterComment } from "./agent";

const setCommentsEffect = StateEffect.define<WriterComment[]>();

const commentsTheme = EditorView.baseTheme({
  ".wr-comment-bubble": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "1px 6px",
    borderRadius: "999px",
    fontSize: "0.8em",
    color: "var(--text-on-accent)",
    marginLeft: "6px",
    cursor: "pointer",
    border: "1px solid var(--background-modifier-border)",
    boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
    whiteSpace: "nowrap",
    maxWidth: "40ch",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  ".wr-comment-bubble:hover": {
    opacity: 0.9,
  },
});

class CommentWidget extends WidgetType {
  comment: WriterComment;

  constructor(comment: WriterComment) {
    super();
    this.comment = comment;
  }

  eq(other: CommentWidget) {
    return (
      this.comment.line === other.comment.line &&
      this.comment.text === other.comment.text &&
      this.comment.agentId === other.comment.agentId
    );
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "wr-comment-bubble";
    span.style.background = this.comment.color || "var(--interactive-accent)";
    span.title = `${this.comment.agentName}: ${this.comment.text}`;

    const label = document.createElement("span");
    label.textContent = `${this.comment.agentName}: ${this.comment.text}`;
    span.appendChild(label);
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

type FieldValue = {
  decos: DecorationSet;
  comments: WriterComment[];
};

function buildDecorations(state: EditorState, comments: WriterComment[]): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const doc = state.doc;
  for (const comment of comments) {
    const lineNum = Math.max(1, Math.min(comment.line, doc.lines));
    const line = doc.line(lineNum);
    const pos = line.to;
    const deco = Decoration.widget({ widget: new CommentWidget(comment), side: 1 });
    widgets.push(deco.range(pos));
  }
  return Decoration.set(widgets, true);
}

const commentsField = StateField.define<FieldValue>({
  create(state) {
    const empty: WriterComment[] = [];
    return { decos: buildDecorations(state, empty), comments: empty } as FieldValue;
  },
  update(value, tr) {
    let comments = value.comments;
    for (const effect of tr.effects) {
      if (effect.is(setCommentsEffect)) {
        comments = effect.value || [];
      }
    }
    if (tr.docChanged || comments !== value.comments) {
      return { decos: buildDecorations(tr.state, comments), comments };
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decos),
});

const commentsExtension = [commentsTheme, commentsField] as const;

export function ensureCommentsInstalled(view: EditorView) {
  if (!hasCommentsField(view)) {
    view.dispatch({ effects: StateEffect.appendConfig.of(commentsExtension) });
  }
}

function hasCommentsField(view: EditorView): boolean {
  try {
    const field = (view.state as any).field(commentsField, false);
    return !!field;
  } catch {
    return false;
  }
}

export function applyComments(view: EditorView, comments: WriterComment[]) {
  ensureCommentsInstalled(view);
  view.dispatch({ effects: setCommentsEffect.of(comments) });
}

export function clearComments(view: EditorView) {
  ensureCommentsInstalled(view);
  view.dispatch({ effects: setCommentsEffect.of([]) });
}
