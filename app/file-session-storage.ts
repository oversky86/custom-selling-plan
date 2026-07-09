import { Session } from "@shopify/shopify-api";
import fs from "node:fs";
import path from "node:path";

/**
 * Simple file-based session storage that persists sessions to a JSON file.
 * Suitable for development only — not for production.
 * Uses toPropertyArray/fromPropertyArray for serialization.
 */
export class FileSessionStorage {
  private filePath: string;
  private sessions: Record<string, [string, any][]> = {};

  constructor(filePath: string = ".shopify-sessions.json") {
    this.filePath = path.resolve(filePath);
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf-8");
        this.sessions = JSON.parse(data);
      }
    } catch {
      this.sessions = {};
    }
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.sessions, null, 2));
  }

  async storeSession(session: Session): Promise<boolean> {
    this.sessions[session.id] = session.toPropertyArray();
    this.save();
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const data = this.sessions[id];
    if (!data) return undefined;
    return Session.fromPropertyArray(data);
  }

  async deleteSession(id: string): Promise<boolean> {
    delete this.sessions[id];
    this.save();
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    for (const id of ids) {
      delete this.sessions[id];
    }
    this.save();
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const results: Session[] = [];
    for (const [id, data] of Object.entries(this.sessions)) {
      try {
        const session = Session.fromPropertyArray(data);
        if (session.shop === shop) {
          results.push(session);
        }
      } catch {
        // skip invalid sessions
      }
    }
    return results;
  }
}
