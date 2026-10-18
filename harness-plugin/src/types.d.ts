/**
 * Minimal declarations for the DeepSeek Harness client APIs and md2chat core
 * files this plugin touches. The Harness modules are provided at runtime by the
 * shell's module table (see scripts/build.mjs externals); only the members used
 * here are declared, mirroring the Harness sources they cite.
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    effect(execute: () => (() => unknown) | void, label?: string): void
    slots: SlotRegistry
    locale: { register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void }
    sessions: { binding(sessionId: string): unknown }
    // packages/client/ui-conversation: binding(session).target('chat') → ChatSnapshot source.
    uiConversation: { binding(binding: unknown): { target(name: 'chat'): { getSnapshot(): ChatSnapshotLike | undefined } } }
  }

  /** packages/client/ui-renderer/src/client/registry.ts (erased to the members used). */
  interface SlotRegistry {
    inject(name: string, register: () => () => void): void
    register<Injected>(options: {
      name: string
      id: string
      order?: number
      locale?: string
      inject?: (sessionId: string) => Injected
    }, component: unknown): () => void
  }

  /** packages/client/ui-chat/src/client/contract/snapshot.ts ChatSnapshot (erased). */
  interface ChatSnapshotLike {
    readonly nodes: { values(): readonly { readonly kind: string; readonly data: unknown }[] }
  }
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement, ReactNode } from 'react'
  export function Modal(props: {
    open: boolean
    onClose: () => void
    title: string
    closeLabel: string
    description?: string
    children?: ReactNode
    footer?: ReactNode
    className?: string
    contentClassName?: string
  }): ReactElement | null
  export function Tooltip(props: { label: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }): ReactElement
  export function Toast(props: { text: string; tone?: 'success'; holdMs?: number; onDone: () => void }): ReactElement
  export function IconShareOutlineRegular(props: { size?: number }): ReactElement
}

declare module 'md2chat-core/chat-markdown.js' {
  const api: {
    parse(source: string): unknown[]
    compactImages(blocks: unknown[]): unknown[]
    runsHtml(runs: unknown[]): string
  }
  export = api
}

declare module 'md2chat-core/chat-payload.js' {
  interface Image { src: string; width: number; height: number; displayWidth?: number; displayHeight?: number; sourceUrl?: string }
  interface TextSegment { type: 'text'; text: string; runs: unknown[] }
  interface ImageSegment { type: 'image'; src: string; displayWidth: number }
  interface TableSegment { type: 'table'; rows: string[][] }
  type Segment = TextSegment | ImageSegment
  interface Payload {
    html: string
    plain: string
    preview: string
    segments: Segment[]
    emailSegments: (Segment | TableSegment)[]
    tableCount: number
    imageCount: number
    tableImages: number
    originalImages: number
    mathImages: number
    mermaidImages: number
    codeImages: number
  }
  const api: {
    build(source: string, deps: {
      markdown: unknown
      renderers: unknown
      renderTable: (header: string[], rows: string[][]) => Image[]
      imageAssets?: Map<string, { src: string }>
      ensureImage: (asset: { src: string }, options: { allowLocal: boolean }) => Promise<Image>
      describeImageError?: (src: string, error: Error) => string
    }): Promise<Payload>
  }
  export = api
  export type { Payload, Segment, Image }
}

declare module 'md2chat-core/renderers.js' {
  const api: { math(tex: string, display?: boolean): Promise<unknown>; mermaid(source: string): Promise<unknown>; code(source: string, language: string): Promise<unknown[]> }
  export = api
}

declare module 'md2chat-core/table-images.js' {
  const api: { render(header: string[], rows: string[][]): { src: string; width: number; height: number }[] }
  export = api
}

declare module 'md2chat-core/chat-targets.js' {
  type Target = 'wechat' | 'dingtalk' | 'feishu' | 'wecom' | 'email'
  const api: {
    profile(target: Target): { label: string; note: string }
    render(parts: unknown[], target: Target): { html: string; plain: string; imageCount: number }
  }
  export = api
  export type { Target }
}


declare module 'md2chat-core/clipboard-image.js' {
  const api: { render(parts: unknown[], options?: { fit?: boolean }): Promise<{ type: 'image'; src: string; width: number; height: number }> }
  export = api
}
