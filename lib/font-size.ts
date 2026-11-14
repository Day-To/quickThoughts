import { Mark, type Editor } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"

/**
 * Text size as part of the text itself, as in Apple Notes: Cmd/Ctrl with + or - makes
 * the selected text one step bigger or smaller; with nothing selected, it sets the
 * size of what is typed next.
 */

/** The sizes the shortcuts step through, in px. */
export const FONT_SIZES = [9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96]
/** The sizes offered in the Format menu. */
export const FONT_SIZE_CHOICES = [10, 12, 14, 16, 18, 24, 32, 48]
export const MIN_FONT_SIZE = 6
export const MAX_FONT_SIZE = 200

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      /** A size in px, or null for the default size of the line (body, title, heading). */
      setFontSize: (size: number | null) => ReturnType
      stepFontSize: (direction: 1 | -1) => ReturnType
    }
  }
}

/** The size text is actually shown at around `pos`, whatever gives it that size. */
function shownSize(view: EditorView, pos: number): number {
  const { node } = view.domAtPos(pos)
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement
  return element ? parseFloat(getComputedStyle(element).fontSize) : 13
}

function step(current: number, direction: 1 | -1): number {
  if (direction > 0) return FONT_SIZES.find((size) => size > current + 0.01) ?? current
  return [...FONT_SIZES].reverse().find((size) => size < current - 0.01) ?? current
}

/** The text size at the cursor (or at the start of the selection), in px. */
export function currentFontSize(editor: Editor): number {
  const { state, view } = editor
  const type = state.schema.marks.fontSize
  const marks = state.storedMarks ?? (state.selection.empty ? state.selection.$from.marks() : state.doc.resolve(state.selection.from + 1).marks())
  const set = marks.find((mark) => mark.type === type)?.attrs.size as number | undefined
  if (set) return set
  // Not mounted yet, or in a test without layout.
  try {
    return Math.round(shownSize(view, Math.min(state.selection.from + (state.selection.empty ? 0 : 1), state.doc.content.size)) * 10) / 10
  } catch {
    return 13
  }
}

export const FontSize = Mark.create({
  name: "fontSize",

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) => {
          const size = parseFloat(element.style.fontSize)
          return Number.isFinite(size) ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size)) : null
        },
        renderHTML: (attributes) => (attributes.size ? { style: `font-size: ${attributes.size}px` } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: "span", getAttrs: (element) => (/px$/.test(element.style.fontSize) ? {} : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0]
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ commands }) => {
          if (size === null) return commands.unsetMark(this.name)
          return commands.setMark(this.name, { size: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size * 10) / 10)) })
        },
      stepFontSize:
        (direction) =>
        ({ state, tr, view, dispatch }) => {
          const { from, to, empty, $from } = state.selection
          const sizeOf = (marks: readonly { type: unknown; attrs: Record<string, unknown> }[]) =>
            marks.find((mark) => mark.type === this.type)?.attrs.size as number | undefined
          if (empty) {
            // Nothing selected: the next thing typed is a step bigger or smaller.
            const current = sizeOf(state.storedMarks ?? $from.marks()) ?? shownSize(view, from)
            if (dispatch) tr.addStoredMark(this.type.create({ size: step(current, direction) }))
            return true
          }
          // Each run of text moves a step from its own size, so mixed sizes stay mixed.
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText) return
            const start = Math.max(pos, from)
            const end = Math.min(pos + node.nodeSize, to)
            const current = sizeOf(node.marks) ?? shownSize(view, start + 1)
            if (dispatch) tr.addMark(start, end, this.type.create({ size: step(current, direction) }))
          })
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    const bigger = () => this.editor.commands.stepFontSize(1)
    const smaller = () => this.editor.commands.stepFontSize(-1)
    return {
      "Mod-=": bigger,
      "Mod-+": bigger,
      "Shift-Mod-=": bigger,
      "Mod-;": bigger,
      "Mod--": smaller,
      "Mod-_": smaller,
    }
  },
})
