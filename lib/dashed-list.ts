import { mergeAttributes, wrappingInputRule } from "@tiptap/core"
import { BulletList } from "@tiptap/extension-list"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dashedList: {
      toggleDashedList: () => ReturnType
    }
  }
}

/** A bullet list rendered with en dashes instead of dots. */
export const DashedList = BulletList.extend({
  name: "dashedList",

  parseHTML() {
    return [{ tag: 'ul[data-type="dashed"]', priority: 60 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["ul", mergeAttributes(HTMLAttributes, { "data-type": "dashed" }), 0]
  },

  addCommands() {
    return {
      toggleDashedList:
        () =>
        ({ commands }) =>
          commands.toggleList(this.name, "listItem"),
    }
  },

  addKeyboardShortcuts() {
    return {}
  },

  // Typing "- " starts a dashed list.
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*-\s$/, type: this.type })]
  },
})

/** Regular bullets, started with "* " or "+ " now that "- " belongs to the dashed list. */
export const DottedList = BulletList.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*[*+•]\s$/, type: this.type })]
  },
})
