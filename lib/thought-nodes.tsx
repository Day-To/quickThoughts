"use client"

import { useRef, useState } from "react"
import { mergeAttributes, Node } from "@tiptap/core"
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react"
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ShoppingBag } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Two blocks the thought pipeline can place in a note, alongside ordinary text:
 * a slider of products it found, and a folded-away list of its sources.
 * Each is a single block in the editor: it can be selected, moved or deleted like a picture.
 */

export type Product = {
  brand: string
  name: string
  price: string | null
  store: string
  url: string
  image: string | null
}
export type Source = { url: string; title: string }

function parseList<T>(value: string | null): T[] {
  try {
    const parsed = JSON.parse(value ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

// ---------- products ----------

function ProductsView({ node, selected }: NodeViewProps) {
  const products = node.attrs.products as Product[]
  const track = useRef<HTMLDivElement>(null)
  const slide = (direction: 1 | -1) =>
    track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.8, behavior: "smooth" })

  return (
    <NodeViewWrapper
      contentEditable={false}
      data-product-slider
      className={cn("group/slider relative my-2 rounded-2xl select-none", selected && "outline-3 outline-app-accent/60")}
    >
      {/* A scrolling row clips whatever pokes outside it, so the row is padded to make room
          for the cards' outlines and hover shadows, and pulled back by the same amount. */}
      <div
        ref={track}
        className="-mx-3 -mt-1 -mb-5 flex snap-x scroll-px-3 gap-3 overflow-x-auto scroll-smooth px-3 pt-2 pb-7 [scrollbar-width:none]"
      >
        {products.map((product, i) => (
          <ProductCard key={i} product={product} />
        ))}
      </div>
      {products.length > 3 && (
        <>
          <SlideButton side="left" onClick={() => slide(-1)} />
          <SlideButton side="right" onClick={() => slide(1)} />
        </>
      )}
    </NodeViewWrapper>
  )
}

function ProductCard({ product }: { product: Product }) {
  const [broken, setBroken] = useState(false)
  return (
    <a
      href={product.url}
      target="_blank"
      rel="noreferrer noopener"
      draggable={false}
      className="flex w-[176px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl bg-card no-underline! ring-1 ring-foreground/10 transition-shadow duration-150 hover:shadow-[0_6px_20px_rgb(0_0_0/0.1)]"
    >
      <span className="relative grid h-[176px] shrink-0 place-items-center bg-white">
        {product.image && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary shop host
          <img
            src={product.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setBroken(true)}
            className="absolute inset-0 m-0! size-full max-w-none! rounded-none! object-contain p-2"
          />
        ) : (
          <ShoppingBag className="size-9 text-neutral-300" strokeWidth={1.4} />
        )}
      </span>
      <span className="flex flex-1 flex-col gap-0.5 border-t border-foreground/10 px-3 py-2.5 text-foreground">
        <span className="truncate text-[11px] font-medium text-muted-foreground">{product.brand}</span>
        <span className="line-clamp-2 text-[13px] leading-[1.3] font-semibold">{product.name}</span>
        <span className="mt-auto flex items-baseline justify-between gap-2 pt-1.5">
          <span className="truncate text-[11.5px] text-muted-foreground">{product.store}</span>
          {product.price && <span className="shrink-0 text-[13px] font-semibold tabular-nums">{product.price}</span>}
        </span>
      </span>
    </a>
  )
}

function SlideButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous products" : "More products"}
      onClick={onClick}
      className={cn(
        "glass absolute top-[88px] grid size-8 -translate-y-1/2 place-items-center rounded-full text-foreground/70 opacity-0 transition-opacity duration-150 group-hover/slider:opacity-100 pointer-coarse:hidden",
        side === "left" ? "-left-3" : "-right-3"
      )}
    >
      {side === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  )
}

export const ProductsNode = Node.create({
  name: "products",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      products: {
        default: [],
        parseHTML: (element) => parseList<Product>(element.getAttribute("data-products")),
        renderHTML: (attributes) => ({ "data-products": JSON.stringify(attributes.products) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="products"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "products" })]
  },
  // So the products count towards the note's searchable text.
  renderText({ node }) {
    return (node.attrs.products as Product[])
      .map((product) => [product.brand, product.name, product.price].filter(Boolean).join(" · "))
      .join("\n")
  },
  addNodeView() {
    return ReactNodeViewRenderer(ProductsView)
  },
})

// ---------- sources ----------

function SourcesView({ node, selected }: NodeViewProps) {
  const sources = node.attrs.sources as Source[]
  const [open, setOpen] = useState(false)

  return (
    <NodeViewWrapper contentEditable={false} data-sources className={cn("my-1.5 select-none", selected && "rounded-lg outline-3 outline-app-accent/60")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-3 text-[12.5px] font-medium text-foreground/70 transition-colors duration-150 hover:bg-foreground/[0.1]"
      >
        {open ? "Hide sources" : "Show sources"}
        <span className="text-muted-foreground">{sources.length}</span>
        <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="m-0! mt-2! grid list-none! gap-1 p-0!">
          {sources.map((source, i) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-baseline gap-2 rounded-lg px-2 py-1 text-[13px] text-foreground! no-underline! hover:bg-foreground/[0.05]"
              >
                <span className="w-4 shrink-0 text-right text-[11.5px] text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{source.title}</span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground">{hostOf(source.url)}</span>
                <ArrowUpRight className="size-3 shrink-0 self-center text-muted-foreground" />
              </a>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  )
}

export const SourcesNode = Node.create({
  name: "sources",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      sources: {
        default: [],
        parseHTML: (element) => parseList<Source>(element.getAttribute("data-sources")),
        renderHTML: (attributes) => ({ "data-sources": JSON.stringify(attributes.sources) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="sources"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "sources" })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(SourcesView)
  },
})
