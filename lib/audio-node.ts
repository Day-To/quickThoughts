import { mergeAttributes, Node } from "@tiptap/core"

/** A voice recording embedded in a note, shown with the browser's audio player. */
export const AudioNode = Node.create({
  name: "audio",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      seconds: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute("data-seconds")) || 0,
        renderHTML: (attributes) => ({ "data-seconds": attributes.seconds }),
      },
    }
  },

  parseHTML() {
    return [{ tag: "audio[src]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["audio", mergeAttributes(HTMLAttributes, { controls: "", preload: "metadata" })]
  },
})
