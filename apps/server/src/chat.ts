import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage, CliId } from '@studyo/api';
import { newId, nowIso, writeJsonAtomic } from './util.ts';

/** `<topic>/chat/chat.json`: the topic's conversation and the CLI session it runs in. */
export interface ChatFile {
  session_id: string | null;
  session_cli: CliId | null;
  messages: ChatMessage[];
}

export class ChatStore {
  /** Last write per topic, so a streaming reply is saved at most every second. */
  private lastSave = new Map<string, number>();

  constructor(private topicDir: (id: string) => string) {}

  private path(topicId: string) {
    return join(this.topicDir(topicId), 'chat', 'chat.json');
  }

  read(topicId: string): ChatFile {
    const path = this.path(topicId);
    if (!existsSync(path)) return { session_id: null, session_cli: null, messages: [] };
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as ChatFile;
    } catch {
      return { session_id: null, session_cli: null, messages: [] };
    }
  }

  write(topicId: string, chat: ChatFile) {
    mkdirSync(join(this.topicDir(topicId), 'chat'), { recursive: true });
    writeJsonAtomic(this.path(topicId), chat);
    this.lastSave.set(topicId, Date.now());
  }

  addTurn(topicId: string, text: string): { user: ChatMessage; assistant: ChatMessage } {
    const chat = this.read(topicId);
    const created = nowIso();
    const user: ChatMessage = {
      id: newId('msg'),
      role: 'user',
      text,
      status: 'complete',
      created,
      job_id: null,
    };
    const assistant: ChatMessage = {
      id: newId('msg'),
      role: 'assistant',
      text: '',
      status: 'pending',
      created,
      job_id: null,
      suggest_enrich: null,
      suggest_quiz: null,
      error: null,
    };
    chat.messages.push(user, assistant);
    this.write(topicId, chat);
    return { user, assistant };
  }

  /** Update one message. `throttle` skips the disk write if the last one was under a second ago. */
  updateMessage(
    topicId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
    throttle = false,
  ): ChatMessage | null {
    if (throttle && Date.now() - (this.lastSave.get(topicId) ?? 0) < 1000) return null;
    const chat = this.read(topicId);
    const msg = chat.messages.find((m) => m.id === messageId);
    if (!msg) return null;
    Object.assign(msg, patch);
    this.write(topicId, chat);
    return msg;
  }

  setSession(topicId: string, sessionId: string, cli: CliId) {
    const chat = this.read(topicId);
    chat.session_id = sessionId;
    chat.session_cli = cli;
    this.write(topicId, chat);
  }
}
