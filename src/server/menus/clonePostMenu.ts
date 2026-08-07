import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";

export const handleClonePostMenu = async (c: Context) => {
  const event = await c.req.json();
  const subreddit = await reddit.getCurrentSubreddit();
  const appUser = await reddit.getCurrentUser();
  const targetId = event.targetId || event.post?.id;
  const appAccount = await reddit.getAppUser();
  
  const setRelayAppPostFlair = (await settings.get("setFlairAfterPosting")) as boolean;
  const relayAppFlairText = (await settings.get("relayAppPostFlairText")) as string;
  const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

  if (perms?.includes("posts") || perms?.includes("all")) {
    const oldPost = await reddit.getPostById(targetId);
    
    const newPost = await reddit.submitPost({
      subredditName: subreddit.name,
      title: oldPost.title,
      text: oldPost.body || "",
    });
    
    await newPost.distinguish();

    if (setRelayAppPostFlair) {
      await reddit.setPostFlair({
        subredditName: subreddit.name,
        postId: newPost.id,
        text: relayAppFlairText,
      });
    }

    await reddit.addModNote({
      subreddit: subreddit.name,
      user: appAccount!.username,
      label: "SOLID_CONTRIBUTOR",
      redditId: newPost.id,
      note: `${appUser?.username} created a mod post (title: ${newPost.title}).`,
    });

    const sendtoModmail = (await settings.get("sendModmail")) as boolean;
    if (sendtoModmail) {
      const logMsg = `**Title**: ${newPost.title}\n\n**URL**: https://reddit.com${newPost.permalink}\n\n**Moderator**: ${appUser?.username}\n\n**Post body**: ${newPost.body}\n\n`;
      await reddit.sendPrivateMessageAsSubreddit({
        fromSubredditName: subreddit.name,
        to: appAccount!.username,
        subject: `Mod post submitted`,
        text: logMsg,
      });
    }

    return c.json({ showToast: { text: "Posted!", appearance: "success" } });
  } else {
    return c.json({ showToast: { text: "You don't have the necessary permissions." } });
  }
};