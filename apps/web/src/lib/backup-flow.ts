import type { Author, DocumentMeta, Id } from '@pnote/core/types';
import { BackupCorrupt, BackupReader, BackupUnsupported, BackupWrongPassword, MIN_BACKUP_PASSWORD } from '@pnote/storage/backup';
import { exportDocument, exportProfile, importDocuments, type ConflictChoice } from '@pnote/storage/backup-io';
import type { BlobSource, BlobStore } from '@pnote/storage/blob-store';
import type { Library } from '@pnote/storage/library';
import type { ProfileService, ProfileSummary } from '@pnote/storage/profiles';
import { BlobStore as Blobs } from '@pnote/storage/blob-store';
import { Library as Lib } from '@pnote/storage/library';
import type { FileExporter } from '../platform/exporter';

export const BACKUP_MIME = 'application/x-pnote-backup';

export function checkBackupPassword(a: string, b: string): string | null {
  if (a.length < MIN_BACKUP_PASSWORD) return `รหัสผ่านไฟล์สำรองต้องมีอย่างน้อย ${MIN_BACKUP_PASSWORD} ตัวอักษร`;
  if (a !== b) return 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
  return null;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const backupFileName = (title: string, d = new Date()) => `${title.replace(/[\\/:*?"<>|]/g, '_')}_${ymd(d)}.pnote`;
export const isBackupFile = (f: { name: string }) => f.name.toLowerCase().endsWith('.pnote');

export function backupErrorText(e: unknown): string {
  if (e instanceof BackupWrongPassword) return 'รหัสผ่านไฟล์สำรองไม่ถูกต้อง';
  if (e instanceof BackupUnsupported) return 'ไม่ใช่ไฟล์สำรอง PNote หรือเป็นรุ่นที่แอปนี้ยังไม่รองรับ';
  if (e instanceof BackupCorrupt) return 'ไฟล์สำรองเสียหายหรือถูกแก้ไข';
  return `เกิดข้อผิดพลาด: ${(e as Error)?.message ?? e}`;
}

export const fileSource = (f: Blob): BlobSource => ({ size: f.size, slice: async (s, e) => new Uint8Array(await f.slice(s, e).arrayBuffer()) });

export async function runExport(exp: FileExporter, how: 'save' | 'share', name: string,
  write: (sink: Parameters<Parameters<FileExporter['saveStream']>[2]>[0]) => Promise<void>): Promise<void> {
  await (how === 'share' ? exp.shareStream : exp.saveStream).call(exp, name, BACKUP_MIME, write);
}

export const exportDoc = (lib: Library, blobs: BlobStore, id: Id, pw: string, by: Author) =>
  (sink: Parameters<typeof exportDocument>[3]) => exportDocument(lib, blobs, id, sink, pw, by);
export const exportAll = (lib: Library, blobs: BlobStore, pw: string, by: Author, onProgress?: (d: number, t: number) => void) =>
  (sink: Parameters<typeof exportProfile>[2]) => exportProfile(lib, blobs, sink, pw, by, onProgress);

export async function importBackup(lib: Library, blobs: BlobStore, file: Blob, pw: string, by: Author,
  choose: (existing: DocumentMeta, incoming: { id: Id; title: string }) => Promise<ConflictChoice>): Promise<DocumentMeta[]> {
  const reader = await BackupReader.open(fileSource(file), pw);
  return importDocuments(lib, blobs, reader, by, choose);
}

/** Restore on a new device: the password is checked before any profile is created. */
export async function restoreProfile(service: ProfileService, file: Blob, pw: string, name: string, secret: string, color: string):
  Promise<{ profile: ProfileSummary; recoveryCode: string; imported: DocumentMeta[] }> {
  const reader = await BackupReader.open(fileSource(file), pw);
  const { profile, recoveryCode } = await service.createFromBackup(name, secret, color);
  const r = await service.unlock(profile.id, secret);
  if (!r.ok) throw new Error('could not open the new profile');
  const by: Author = { profileId: profile.id, name: profile.name };
  const lib = new Lib(r.store, by);
  const imported = await importDocuments(lib, new Blobs(r.store), reader, by, async () => 'copy');
  return { profile, recoveryCode, imported };
}
