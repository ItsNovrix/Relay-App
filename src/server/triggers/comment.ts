import type { Context } from 'hono';
import { reddit, redis, settings } from "@devvit/web/server";
import { getCommentAuthor, isModerator } from "../utils/helpers.js";

export const handleCommentCreate = async (c: Context) => {
  const event = await c.req.json();
  if (!event.comment || !event.author?.name) return c.json({ success: true });

  // Cache comment author for 24 hours to identify replies later
  await redis.set(`author:${event.comment.id}`, event.author.name, { expiration: new Date(Date.now() + 86400000) });

  const allSettings = await settings.getAll();
  const appUser = await reddit.getAppUser();
  const extraUsers = ((allSettings.notify_extra_users as string) || "").split(',').map(u => u.trim().toLowerCase());
  
  const parentId = event.comment.parentId;
  const isReplyToPost = parentId.startsWith('t3_');
  const isReplyToComment = parentId.startsWith('t1_');

  let parentAuthor = "";
  if (isReplyToPost) {
    const post = await reddit.getPostById(parentId);
    parentAuthor = post.authorName ?? "[deleted]"; 
  } else if (isReplyToComment) {
    parentAuthor = await getCommentAuthor(parentId);
  }

  // Check if the person being replied to is Relay App or other monitored user
  const isMonitored = parentAuthor.toLowerCase() === appUser?.username.toLowerCase() || extraUsers.includes(parentAuthor.toLowerCase());
  if (!isMonitored) return c.json({ success: true });

  // Check if notifications are enabled for this type of reply
  if (isReplyToPost && !allSettings.notify_on_posts) return c.json({ success: true });
  if (isReplyToComment && !allSettings.notify_on_comments) return c.json({ success: true });

  // Filter out moderators if settings logic dictates it
  if (!allSettings.notify_on_mod_replies && await isModerator(event.author.name)) return c.json({ success: true });

  // Send Modmail notification
  const quotedBody = event.comment.body
    .split("\n")
    .map((line: string) => `> ${line}`)
    .join("\n");

  await reddit.modMail.createModInboxConversation({
    subredditId: event.subreddit.id,
    subject: "Relay App: New Reply Received",
    bodyMarkdown: `u/${event.author.name} has replied to a ${isReplyToPost ? 'post' : 'comment'} by ${parentAuthor}.\n\n**Comment Text:**\n${quotedBody}\n\n[View Reply](https://www.reddit.com${event.comment.permalink})\n\n---\n*I am a bot, and this action was triggered automatically.*`,
  });

  return c.json({ success: true });
};