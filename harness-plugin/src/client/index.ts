/**
 * md2chat share plugin, browser half: a Share entry in every settled
 * assistant reply's action strip (conversation.chat.assistant-actions).
 */
import type { Context } from '@deepseek-ai/cordis'
import { ShareAction, type ShareInjected } from './ShareAction.tsx'
import { en, zh } from './locales.ts'
import { injectStyles } from './styles.ts'
import { replyMarkdown } from './reply.ts'

const NS = 'md2chatShare'

export const name = 'md2chat-share'
export const inject = ['slots', 'locale', 'sessions', 'uiConversation']

export function apply(ctx: Context): void {
  ctx.effect(() => injectStyles(), 'md2chat-share: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'md2chat-share: dictionaries')

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register<ShareInjected>({
    name: 'conversation.chat.assistant-actions',
    id: 'md2chat-share',
    order: 20,
    locale: NS,
    inject: sessionId => ({
      getMarkdown: (messageId) => {
        const binding = ctx.sessions.binding(sessionId)
        if (binding === undefined) return ''
        return replyMarkdown(ctx.uiConversation.binding(binding).target('chat').getSnapshot(), messageId)
      },
    }),
  }, ShareAction))
}
