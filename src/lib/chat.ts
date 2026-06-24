// Shared types + helpers for the player-to-player chat (ChatBubble.tsx).

/** Name shown for the single shared group room. */
export const GROUP_CONV_NAME = 'Global chat';

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type ChatConversation = {
  id: string;
  kind: 'group' | 'dm';
  user_a: string | null;
  user_b: string | null;
};

export type RosterPlayer = {
  id: string;
  display_name: string;
  color: string | null;
  flag_code: string | null;
};

/** WhatsApp-style receipt for one of MY messages in a DM. */
export type TickState = 'sent' | 'delivered' | 'read';

/**
 * Receipt for one of my DM messages:
 *   read      -> the other player's read watermark is at/after this message
 *   delivered -> they haven't read it yet but are online right now
 *   sent      -> stored on the server, recipient offline and hasn't read
 */
export function dmTickState(
  createdAt: string,
  otherLastReadAt: string | undefined,
  otherOnline: boolean,
): TickState {
  if (otherLastReadAt && new Date(otherLastReadAt).getTime() >= new Date(createdAt).getTime()) {
    return 'read';
  }
  return otherOnline ? 'delivered' : 'sent';
}

/** How many of the OTHER group members have read a given message. */
export function seenByCount(
  createdAt: string,
  otherMemberIds: string[],
  readsByUser: Map<string, string>,
): number {
  const t = new Date(createdAt).getTime();
  let n = 0;
  for (const id of otherMemberIds) {
    const r = readsByUser.get(id);
    if (r && new Date(r).getTime() >= t) n++;
  }
  return n;
}

/** Count of unread messages in a conversation given my read watermark. */
export function unreadCount(msgs: ChatMessage[], myLastReadAt: string | undefined, me: string): number {
  const t = myLastReadAt ? new Date(myLastReadAt).getTime() : 0;
  let n = 0;
  for (const m of msgs) {
    if (m.sender_id !== me && new Date(m.created_at).getTime() > t) n++;
  }
  return n;
}

/** Short HH:MM timestamp for a message bubble. */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
