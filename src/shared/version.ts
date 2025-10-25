import { readFileSync } from "node:fs";
import path from "node:path";

type PackageMetadata = { version: string };

function loadPackageVersion(): string {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  try {
    const contents = readFileSync(packageJsonPath, "utf-8");
    const metadata = JSON.parse(contents) as PackageMetadata;
    return metadata.version;
  } catch (error) {
    if (error instanceof Error) {
      error.message = `Failed to read package metadata: ${error.message}`;
    }
    throw error;
  }
}

export const PACKAGE_VERSION = loadPackageVersion();
