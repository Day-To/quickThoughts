import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"

/**
 * Touch screens: tapping a checklist circle ticks it, and nothing else. Without this a
 * tap on (or just beside) the circle also lands in the text, which puts the cursor
 * there and brings up the keyboard, and on iPhone often fails to tick the item at all.
 */
export const TaskTap = Extension.create({
  name: "taskTap",

  addProseMirrorPlugins() {
    // Where the finger went down, to tell a tap from the start of a scroll.
    let start: { x: number; y: number } | null = null

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            touchstart(_view, event) {
              const touch = event.touches.length === 1 ? event.touches[0] : null
              start = touch && { x: touch.clientX, y: touch.clientY }
              return false
            },
            touchend(view, event) {
              const touch = event.changedTouches[0]
              const began = start
              start = null
              if (!view.editable || !touch || !began) return false
              if (Math.hypot(touch.clientX - began.x, touch.clientY - began.y) > 10) return false

              // In the editor a checklist item is a plain <li> directly inside the checklist.
              const item = (event.target as Element | null)?.closest?.('ul[data-type="taskList"] > li')
              const circle = item?.querySelector(":scope > label")?.getBoundingClientRect()
              // A generous target: the circle and a finger's width around it.
              if (!item || !circle) return false
              if (touch.clientX > circle.right + 10 || touch.clientY < circle.top - 10 || touch.clientY > circle.bottom + 10) return false

              const inside = view.state.doc.resolve(view.posAtDOM(item, 0))
              for (let depth = inside.depth; depth > 0; depth--) {
                const node = inside.node(depth)
                if (node.type.name !== "taskItem") continue
                // Stops the tap becoming a click: no cursor placed, no keyboard.
                event.preventDefault()
                view.dispatch(view.state.tr.setNodeMarkup(inside.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked }))
                return true
              }
              return false
            },
          },
        },
      }),
    ]
  },
})
