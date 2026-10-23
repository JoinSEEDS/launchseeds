import { openDatabase } from "./connection";
import { createRepo } from "./repo";

export function openLaunchseedsData(path?: string) {
  const database = openDatabase(path);
  return { database, repo: createRepo(database) };
}
export * from "./schema";
export type { LaunchseedsRepo, Repos } from "./repo";
