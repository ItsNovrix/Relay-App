import { reddit, redis, settings } from "@devvit/web/server";

export async function getCommentAuthor(commentId: string): Promise<string> {
  const cachedAuthor = await redis.get(`author:${commentId}`);
  if (cachedAuthor) return cachedAuthor;
  try {
    const comment = await reddit.getCommentById(`t1_${commentId.replace(/^t1_/, '')}` as `t1_${string}`);
    return comment.authorName ?? "[deleted]";
  } catch {
    return "[deleted]";
  }
}

export async function isModerator(username: string): Promise<boolean> {
  const subreddit = await reddit.getCurrentSubreddit();
  const subredditName = subreddit.name;
  if (username === `${subredditName}-ModTeam` || username === "AutoModerator") return true;
  try {
    const moderators = await reddit.getModerators({ subredditName, username }).all();
    return moderators.length > 0;
  } catch {
    return false;
  }
}

export function getMonthlyCron(monthDay: number, hour: number, minute: number, targetDate: Date = new Date()): string {
  if (monthDay < 1) monthDay = 1;
  if (monthDay > 31) monthDay = 31;

  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(monthDay, daysInMonth);

  return `${minute} ${hour} ${day} * *`;
}

export async function getVariableTimezone(): Promise<string> {
  const raw = await settings.get("variableTimezone");
  const tz = (Array.isArray(raw) ? raw[0] : raw) as string;
  return tz || "UTC";
}

export function applyDynamicVariables(
  text: string | undefined,
  subreddit: { name: string; numberOfSubscribers?: number },
  timezone: string = "UTC"
): string {
  if (!text) return "";

  const now = new Date();
  let safeTz = timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: safeTz }).format(now);
  } catch {
    safeTz = "UTC";
  }

  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: safeTz, ...options }).format(now);

  const variables: Record<string, string> = {
    subreddit: subreddit.name,
    subscribers:
      typeof subreddit.numberOfSubscribers === "number"
        ? subreddit.numberOfSubscribers.toLocaleString("en-US")
        : "0",
    date: fmt({ month: "long", day: "numeric", year: "numeric" }),
    shortdate: fmt({ month: "2-digit", day: "2-digit", year: "numeric" }),
    weekday: fmt({ weekday: "long" }),
    month: fmt({ month: "long" }),
    day: fmt({ day: "numeric" }),
    year: fmt({ year: "numeric" }),
  };

  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const replacement = variables[key.toLowerCase()];
    return replacement !== undefined ? replacement : match;
  });
}

export async function getPostFlairOptions(
  subredditName?: string
): Promise<{ label: string; value: string }[]> {
  try {
    const targetSub = subredditName || (await reddit.getCurrentSubreddit()).name;
    const templates = await reddit.getPostFlairTemplates(targetSub);
    if (!templates || templates.length === 0) return [];

    return [
      { label: "None", value: "none" },
      ...templates.map((t) => {
        const baseLabel = t.text?.trim() || "(Untitled Flair)";
        return {
          label: t.modOnly ? `${baseLabel} (Mod Only)` : baseLabel,
          value: t.id,
        };
      }),
    ];
  } catch (err) {
    console.warn("[Flair Helper] Could not fetch post flair templates:", err);
    return [];
  }
}

export function extractFlairId(raw: unknown): string {
  const val = ((Array.isArray(raw) ? raw[0] : raw) as string || "").trim();
  return val === "none" ? "" : val;
}