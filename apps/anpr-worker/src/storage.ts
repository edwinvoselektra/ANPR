import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { EventImage } from "./types.js";

export interface StorageProvider {
  storePassageImage(image: EventImage, occurredAt: Date): Promise<string>;
  delete(objectId: string): Promise<void>;
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly rootPath: string, private readonly maxImageBytes: number) {}

  async storePassageImage(image: EventImage, occurredAt: Date): Promise<string> {
    if (image.contentType !== "image/jpeg" || image.data.length < 4 || image.data.length > this.maxImageBytes
      || image.data[0] !== 0xff || image.data[1] !== 0xd8 || image.data.at(-2) !== 0xff || image.data.at(-1) !== 0xd9) {
      throw new Error("INVALID_IMAGE");
    }
    const year = String(occurredAt.getUTCFullYear());
    const month = String(occurredAt.getUTCMonth() + 1).padStart(2, "0");
    const objectId = `passages/${year}/${month}/${randomUUID()}.jpg`;
    const root = resolve(this.rootPath);
    const destination = resolve(root, objectId);
    if (!destination.startsWith(`${root}${sep}`)) throw new Error("INVALID_OBJECT_PATH");
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, image.data, { mode: 0o600, flag: "wx" });
      await rename(temporary, destination);
      return objectId;
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async delete(objectId: string): Promise<void> {
    const root = resolve(this.rootPath);
    const file = resolve(root, objectId);
    if (!file.startsWith(`${root}${sep}`)) throw new Error("INVALID_OBJECT_PATH");
    await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}
