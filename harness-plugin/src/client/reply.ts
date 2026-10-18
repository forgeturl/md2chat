import type { ChatSnapshotLike } from '@deepseek-ai/cordis'

/** packages/client/ui-chat/src/client/contract/chat-nodes.ts TurnTailChatData (erased to the read members). */
interface TurnTailData {
  readonly closing: {
    readonly blocks: readonly ({ readonly kind: 'text'; readonly text: string } | { readonly kind: string })[]
    readonly finalNode: { readonly messageId?: string }
  } | null
}

/**
 * Join the text blocks of the turn whose closing message is `messageId` —
 * the same text the built-in Copy action uses (ui-chat assistantText).
 */
export function replyMarkdown(snapshot: ChatSnapshotLike | undefined, messageId: string): string {
  for (const node of snapshot?.nodes.values() ?? []) {
    if (node.kind !== 'turn-tail') continue
    const closing = (node.data as TurnTailData).closing
    if (closing?.finalNode.messageId !== messageId) continue
    return closing.blocks.flatMap(block => block.kind === 'text' && 'text' in block ? [block.text] : []).join('')
  }
  return ''
}
