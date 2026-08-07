import type { Context } from 'hono';
import { reddit } from "@devvit/web/server";

export const handleDeleteContentMenu = async (c: Context) => {
  const event = await c.req.json();
  const subreddit = await reddit.getCurrentSubreddit();
  const currentUser = await reddit.getCurrentUser();
  const appUser = await reddit.getAppUser();
  const perms = await currentUser?.getModPermissionsForSubreddit(subreddit.name);
  
  // Devvit passes targetId (the post or comment ID the menu was clicked on) in the event payload
  const targetId = event.targetId;
  const location = targetId?.startsWith('t3_') ? 'post' : 'comment';

  if ((location === "post" && perms?.includes("posts")) || (location === "comment" && perms?.includes("posts")) || perms?.includes("all")) {
    if (location === 'post') {
      const appPost = await reddit.getPostById(targetId);
      if (appPost.authorName === appUser!.username) {
        await appPost.delete();
        return c.json({ showToast: { text: "Deleted!", appearance: "success" } });
      } else {
        return c.json({ showToast: { text: `This is only for content removal by ${appUser!.username}!` } });
      }
    } else {
      const appComment = await reddit.getCommentById(targetId);
      if (appComment.authorName === appUser!.username) {
        await appComment.delete();
        return c.json({ showToast: { text: "Deleted!", appearance: "success" } });
      } else {
        return c.json({ showToast: { text: `This is only for content removal by ${appUser!.username}!` } });
      }
    }
  } else {
    return c.json({ showToast: { text: "You don't have the necessary permissions." } });
  }
};