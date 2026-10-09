import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import type { User } from '../auth';

export type DocumentRef = { documentId: string };
export type DocumentKind = 'summary' | 'amendment' | 'pickup' | 'return';
type DocumentOptions = { kind: DocumentKind; sourceId?: string; eventKey: string };
export type DocumentMetadata = { documentId: string; fileName: string; kind: DocumentKind; version: number;
  contentType: 'application/pdf'; size: number; sha256: string; createdAt: string | Date };
type LoadedDocument = DocumentMetadata & { data: Buffer };
type DocumentsRuntime = {
  createBookingDocuments(db: Pool | PoolClient, bookingId: string, options: DocumentOptions): Promise<DocumentRef[]>;
  listBookingDocuments(db: Pool | PoolClient, bookingId: string, user: User): Promise<DocumentMetadata[]>;
  loadBookingDocument(db: Pool | PoolClient, bookingId: string, documentId: string, user: User): Promise<LoadedDocument>;
};
const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<DocumentsRuntime>;
let loaded: Promise<DocumentsRuntime> | undefined;
function documents() {
  return loaded ||= importModule(pathToFileURL(path.resolve(__dirname, '../../../../packages/documents/service.mjs')).href);
}
export async function createBookingDocuments(db: Pool | PoolClient, bookingId: string, options: DocumentOptions): Promise<DocumentRef[]> {
  return (await documents()).createBookingDocuments(db, bookingId, options);
}
export async function listBookingDocuments(db: Pool | PoolClient, bookingId: string, user: User): Promise<DocumentMetadata[]> {
  return (await documents()).listBookingDocuments(db, bookingId, user);
}
export async function loadBookingDocument(db: Pool | PoolClient, bookingId: string, documentId: string, user: User): Promise<LoadedDocument> {
  return (await documents()).loadBookingDocument(db, bookingId, documentId, user);
}
