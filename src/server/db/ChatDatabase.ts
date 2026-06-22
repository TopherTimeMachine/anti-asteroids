import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChatMessage } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ChatRow {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_color: string;
  text: string;
  is_system: number;
  timestamp: number;
}

export class ChatDatabase {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const dataDir = path.resolve(__dirname, '../../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const resolvedPath = dbPath ?? path.join(dataDir, 'chat.db');
    this.db = new DatabaseSync(resolvedPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_color TEXT NOT NULL,
        text TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_messages(timestamp)
    `);
  }

  saveMessage(msg: ChatMessage): void {
    const stmt = this.db.prepare(`
      INSERT INTO chat_messages (id, sender_id, sender_name, sender_color, text, is_system, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      msg.id,
      msg.senderId,
      msg.senderName,
      msg.senderColor,
      msg.text,
      msg.isSystem ? 1 : 0,
      msg.timestamp
    );
  }

  getRecentMessages(limit: number): ChatMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, sender_id, sender_name, sender_color, text, is_system, timestamp
      FROM chat_messages
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as unknown as ChatRow[];

    return rows.reverse().map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      senderColor: row.sender_color,
      text: row.text,
      isSystem: row.is_system === 1,
      timestamp: row.timestamp,
    }));
  }

  close(): void {
    this.db.close();
  }
}
