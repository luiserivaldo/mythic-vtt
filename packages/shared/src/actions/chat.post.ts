import { ChatPost } from '../schema/index.js';
import { defineAction } from './define.js';
import { appendChat, canPostChat, chatAuthor } from './chat-access.js';

export const chatPost = defineAction({
  type: 'chat.post',
  schema: ChatPost,
  permission: (state, actor, payload) => canPostChat(state, actor, payload.audience),
  reduce(state, a) {
    appendChat(state, {
      id: a.id,
      sessionId: a.sessionId,
      seq: a.seq,
      ts: a.ts,
      author: chatAuthor(state, a.actor),
      kind: 'text',
      ...a.payload,
    });
  },
  modExposed: false,
});
