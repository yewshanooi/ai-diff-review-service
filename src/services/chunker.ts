import { ParsedFile } from '../types';
import { config } from '../config';

/**
 * Split parsed files into chunks of at most chunkBytes (64 KiB).
 * Splitting only happens on file boundaries — one file's diff never spans two chunks.
 * A single file over chunkBytes gets its own chunk.
 *
 * Returns an array of chunks, each being an array of ParsedFiles.
 */
export function chunkFiles(files: ParsedFile[]): ParsedFile[][] {
  const maxChunkSize = config.chunkBytes;
  const chunks: ParsedFile[][] = [];
  let currentChunk: ParsedFile[] = [];
  let currentChunkSize = 0;

  for (const file of files) {
    const fileSize = Buffer.byteLength(file.rawContent, 'utf-8');

    // If this single file exceeds the chunk size, it gets its own chunk
    if (fileSize > maxChunkSize) {
      // Save current chunk if non-empty
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentChunkSize = 0;
      }
      // This file is its own chunk
      chunks.push([file]);
      continue;
    }

    // If adding this file would exceed the chunk size, start a new chunk
    if (currentChunkSize + fileSize > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChunkSize = 0;
    }

    currentChunk.push(file);
    currentChunkSize += fileSize;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
