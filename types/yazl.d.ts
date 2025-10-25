declare module "yazl" {
  import type { Readable } from "node:stream";

  export class ZipFile {
    outputStream: Readable;
    addBuffer(buffer: Buffer, metadataPath: string): void;
    addFile(filePath: string, metadataPath: string): void;
    end(options?: { forceZip64Format?: boolean }): void;
  }
}
