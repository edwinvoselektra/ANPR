import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./storage.js";

const jpeg=Buffer.from([0xff,0xd8,0x01,0x02,0xff,0xd9]);
describe("lokale passage-opslag",()=>{
  it("slaat een JPEG op onder een willekeurig veilig object-ID",async()=>{const root=await mkdtemp(join(tmpdir(),"anpr-storage-"));const storage=new LocalStorageProvider(root,1000);const id=await storage.storePassageImage({contentType:"image/jpeg",data:jpeg},new Date("2026-09-02"));expect(id).toMatch(/^passages\/2026\/09\/[0-9a-f-]{36}\.jpg$/);expect(await readFile(join(root,id))).toEqual(jpeg);expect(id).not.toContain("12ABC3")});
  it("weigert ongeldige en te grote afbeeldingen",async()=>{const root=await mkdtemp(join(tmpdir(),"anpr-storage-"));const storage=new LocalStorageProvider(root,5);await expect(storage.storePassageImage({contentType:"image/jpeg",data:jpeg},new Date())).rejects.toThrow("INVALID_IMAGE")});
  it("blokkeert path traversal bij verwijderen",async()=>{const root=await mkdtemp(join(tmpdir(),"anpr-storage-"));await expect(new LocalStorageProvider(root,1000).delete("../secret.jpg")).rejects.toThrow("INVALID_OBJECT_PATH")});
});
