import { Collection, Db, Document, Filter, MongoClient } from "mongodb";

type OrbitMongo = { client: MongoClient; db: Db };
declare global { var orbitMongoPromise: Promise<OrbitMongo> | undefined; }

export async function getMongoDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI to your MongoDB Atlas connection string or local MongoDB URI.");
  if (!global.orbitMongoPromise) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 10 });
    global.orbitMongoPromise = client.connect().then(async () => {
      const db = client.db(process.env.MONGODB_DATABASE || "orbit");
      await Promise.all([
        db.collection("repository_snapshots").createIndex({ fullName: 1 }, { unique: true }),
        db.collection("repository_snapshots").createIndex({ syncedAt: -1 }),
        db.collection("users").createIndex({ user_id: 1 }, { unique: true }),
        db.collection("repositories").createIndex({ repo_id: 1 }, { unique: true }),
        db.collection("repositories").createIndex({ fullNameKey: 1 }, { unique: true }),
        db.collection("repositories").createIndex({ owner_id: 1, updated_at: -1 }),
        db.collection("audit_events").createIndex({ created_at: -1 }),
        db.collection<Document & { _id: string }>("orbit_metadata").updateOne({ _id: "orbit" }, { $setOnInsert: {
          name: "Orbit",
          project_title: "GitHub Repository Intelligence & Developer Ecosystem Mapper",
          description: "A GitHub-connected workspace for repository management, developer analytics, collaboration insights, AI-assisted project understanding, and ecosystem mapping.",
          objectives: [
            "Manage and explore GitHub repositories and project files.",
            "Analyze repository activity, commits, contributions, and programming languages.",
            "Surface collaboration signals across developers, issues, and pull requests.",
            "Explain repository evidence and suggest improvements with AI.",
            "Map relationships between developers, repositories, languages, and topics.",
          ],
          collections: {
            users: "Orbit and linked GitHub account records; OAuth tokens are encrypted.",
            orbit_accounts: "Optional Orbit username accounts with salted password hashes.",
            repositories: "Synced repository metadata and workspace ownership.",
            repository_snapshots: "Repository README, analytics, activity, and scan snapshots.",
            audit_events: "Account and repository actions performed in Orbit.",
          },
          schema_version: 1,
          created_at: new Date(),
        } }, { upsert: true }),
      ]);
      return { client, db };
    }).catch((error) => { global.orbitMongoPromise = undefined; throw error; });
  }
  return (await global.orbitMongoPromise).db;
}

export async function repositorySnapshots(): Promise<Collection<Document & { _id: string }>> {
  return (await getMongoDatabase()).collection<Document & { _id: string }>("repository_snapshots");
}

export function mongoErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "MongoDB connection failed.";
}

export type OrbitUserDocument = Document & {
  user_id: number; github_id?: number; google_id?: string; username_key?: string; login: string; full_name: string; email: string;
  role: string; avatar_url: string | null; github_access_token?: string;
  password_hash?: string; password_salt?: string; auth_provider?: string;
  pinned_repo_ids?: number[]; pinned_entities?: Array<{ type: "organization" | "project"; id: string; label: string }>; created_at: Date;
};
export type OrbitRepositoryDocument = Document & {
  repo_id: number; owner_id: number; owner_name: string; name: string; full_name: string;
  fullNameKey: string; description: string; primary_language: string; visibility: "public" | "private";
  is_archived: boolean; stars_count: number; forks_count: number; open_issues_count: number;
  topics: string[]; readme: string; updated_at: Date | string; created_at: Date;
  language_bytes?: Record<string, number>; pinned_by?: number[];
  collaborator_ids?: number[]; commit_count?: number;
};
export type OrbitProjectDocument = Document & {
  project_id: string; owner_id: number; name: string; description: string; repositories: string[];
  items: Array<{ item_id: string; title: string; repository: string | null; status: "todo" | "in_progress" | "done"; created_at: Date }>;
  created_at: Date; updated_at: Date;
};

export async function usersCollection() { return (await getMongoDatabase()).collection<OrbitUserDocument>("users"); }
export async function orbitAccountsCollection() {
  const collection = (await getMongoDatabase()).collection("orbit_accounts");
  await Promise.all([collection.createIndex({ username_key: 1 }, { unique: true }), collection.createIndex({ user_id: 1 }, { unique: true })]);
  return collection;
}
export async function googleAccountsCollection() {
  const collection = (await getMongoDatabase()).collection("google_accounts");
  await Promise.all([collection.createIndex({ google_id: 1 }, { unique: true }), collection.createIndex({ user_id: 1 }, { unique: true })]);
  return collection;
}
export async function repositoriesCollection() { return (await getMongoDatabase()).collection<OrbitRepositoryDocument>("repositories"); }
export async function auditEventsCollection() { return (await getMongoDatabase()).collection("audit_events"); }
export async function projectsCollection() {
  const collection = (await getMongoDatabase()).collection<OrbitProjectDocument>("orbit_projects");
  await Promise.all([collection.createIndex({ project_id: 1 }, { unique: true }), collection.createIndex({ owner_id: 1, updated_at: -1 })]);
  return collection;
}
export async function getOrbitUser(userId: number) { return (await usersCollection()).findOne({ user_id: userId }); }
export async function getGithubToken(userId: number) {
  const user = await getOrbitUser(userId);
  if (!user?.github_access_token) return null;
  const { decryptGithubToken } = await import("@/lib/github-auth");
  return decryptGithubToken(user.github_access_token);
}
export async function getRepositoryById(repoId: number) { return (await repositoriesCollection()).findOne({ repo_id: repoId }); }
export function repositoryAccessFilter(user: { user_id: number; role: string }): Filter<OrbitRepositoryDocument> {
  return user.role === "admin"
    ? {}
    : { $or: [{ visibility: "public" as const }, { owner_id: user.user_id }, { collaborator_ids: user.user_id }] };
}
export function repositoryWorkspaceFilter(user: { user_id: number; role: string }): Filter<OrbitRepositoryDocument> {
  return user.role === "admin" ? {} : { $or: [{ owner_id: user.user_id }, { collaborator_ids: user.user_id }] };
}
export async function canReadRepository(repo: OrbitRepositoryDocument, user: { user_id: number; role: string }) {
  return user.role === "admin" || repo.visibility === "public" || repo.owner_id === user.user_id || (repo.collaborator_ids ?? []).includes(user.user_id);
}

export async function saveGitHubRepository(ownerId: number, raw: Record<string, unknown>, details: Record<string, unknown> = {}) {
  const fullName = String(raw.full_name ?? "");
  const [ownerName, name] = fullName.split("/", 2);
  const topics = Array.isArray(raw.topics) ? raw.topics.map(String) : [];
  const languages = details.languages && typeof details.languages === "object" ? details.languages as Record<string, number> : {};
  const readme = String(details.readme ?? "");
  const set = {
    repo_id: Number(raw.id), owner_name: ownerName || String(raw.owner && (raw.owner as {login?:string}).login || ""), name: String(raw.name ?? name ?? ""), full_name: fullName,
    fullNameKey: fullName.toLowerCase(), description: String(raw.description ?? ""), primary_language: String(raw.language ?? Object.entries(languages).sort((a,b)=>Number(b[1])-Number(a[1]))[0]?.[0] ?? "Unknown"),
    visibility: raw.private === true ? "private" as const : "public" as const, is_archived: raw.archived === true,
    stars_count: Number(raw.stargazers_count) || 0, forks_count: Number(raw.forks_count) || 0, open_issues_count: Number(raw.open_issues_count) || 0,
    topics, readme: readme.slice(0, 20000), language_bytes: languages,
    updated_at: raw.updated_at ? new Date(String(raw.updated_at)) : new Date(), updatedBy: ownerId, ...details,
  };
  const collection = await repositoriesCollection();
  await collection.updateOne({ repo_id: set.repo_id }, { $set: set, $setOnInsert: { owner_id: ownerId, created_at: new Date(), pinned_by: [] }, $addToSet: { collaborator_ids: ownerId } }, { upsert: true });
  const saved = await collection.findOne({ repo_id: set.repo_id });
  if (!saved) throw new Error("MongoDB did not return the saved repository.");
  const readmeChecked = details.readmeChecked === true;
  await (await repositorySnapshots()).updateOne({ _id: set.fullNameKey }, { $set: { fullName, githubId: set.repo_id, metadata: raw, languages, recentActivity: details.recentActivity ?? {}, readme, readmeChecked, syncedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  return saved;
}
