import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LoyaltyNode, type NodeSnapshot } from "../node.js";

export async function loadNode(
  path: string,
  clock?: () => number,
): Promise<LoyaltyNode> {
  try {
    const raw = await readFile(path, "utf8");
    const snapshot = JSON.parse(raw) as NodeSnapshot;
    return LoyaltyNode.fromSnapshot(snapshot, { clock });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return new LoyaltyNode({ clock });
    }
    throw err;
  }
}

export async function saveNode(path: string, node: LoyaltyNode): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const snapshot = node.exportSnapshot();
  await writeFile(path, JSON.stringify(snapshot, null, 2), "utf8");
}
