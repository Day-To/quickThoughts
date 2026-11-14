import type { Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import Highlight from "@tiptap/extension-highlight"
import { AudioNode } from "./audio-node"
import { DashedList, DottedList } from "./dashed-list"
import { DrawingNode } from "./drawing-node"
import { FontSize } from "./font-size"
import type { NotePatch } from "./store"
import { ProductsNode, SourcesNode } from "./thought-nodes"

/**
 * Everything a note can contain, shared by the note editor and the home composer so
 * both format text the same way as you type ("- " dashed list, "[ ] " checklist,
 * "1. " numbered list, "# " heading, **bold**, and so on).
 */
export function noteExtensions(placeholder: string) {
  return [
    StarterKit.configure({ link: { openOnClick: false }, bulletList: false }),
    DottedList,
    DashedList,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ allowBase64: true }),
    AudioNode,
    DrawingNode,
    ProductsNode,
    SourcesNode,
    Highlight,
    FontSize,
    Placeholder.configure({ placeholder }),
  ]
}

/** What the rest of the app stores about a note: its content plus the title and preview derived from it. */
export function describeNote(editor: Editor): NotePatch {
  // One entry per line of text, so a note that opens with a list is titled by its first item.
  const lines: string[] = []
  editor.state.doc.descendants((node) => {
    if (!node.isTextblock) return true
    const text = node.textContent.trim()
    if (text) lines.push(text)
    return false
  })
  return {
    content: editor.getHTML(),
    // One line per block; the default double newline leaves gaps in previews.
    text: editor.getText({ blockSeparator: "\n" }),
    title: lines[0] ?? "",
    snippet: lines[1] ?? "",
    empty: editor.isEmpty,
  }
}
