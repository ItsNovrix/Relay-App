import { reddit, redis } from "@devvit/web/server";

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