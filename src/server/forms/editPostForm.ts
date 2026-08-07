import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";

export const handleEditPostForm = async (c: Context) => {
  const event = await c.req.json();
  const subreddit = await reddit.getCurrentSubreddit();
  const appAccount = await reddit.getAppUser();
  const currentUser = await reddit.getCurrentUser();
  const targetId = event.data?.targetId || event.targetId;

  const getPost = await reddit.getPostById(targetId);
  const oldBody = getPost.body;
  
  const newPostBody = event.nBody || event.values?.nBody;
  const reasonRev = event.reasonRevision || event.values?.reasonRevision || "No reason provided";
  const distinguishPost = event.mybDist ?? event.values?.mybDist;
  const stickyPost = event.iSticky ?? event.values?.iSticky;
  const lockPost = event.iLock ?? event.values?.iLock;

  if (distinguishPost === false) { getPost.undistinguish(); } else { getPost.distinguish(); }
  if (stickyPost === false) { getPost.unsticky(); } else { getPost.sticky(); }
  if (lockPost === false) { await getPost.unlock(); } else { await getPost.lock(); }

  await getPost.edit({ text: newPostBody });

  await reddit.addModNote({
    subreddit: subreddit.name,
    user: appAccount!.username,
    label: "SOLID_CONTRIBUTOR",
    note: `${currentUser?.username} edited mod post, reason: ${reasonRev}`,
    redditId: targetId,
  });

  const sendtoModmail = (await settings.get("sendModmail")) as boolean;
  const sendtoDiscord = (await settings.get("sendDiscord")) as boolean;

  let logMsg = `Title: ${getPost.title}\n\nURL: https://reddit.com${getPost.permalink}\n\nModerator: ${currentUser?.username}\n\nPrevious post body: ${oldBody}\n\nNew post body: ${newPostBody}\n\nReason for revision: ${reasonRev}\n\n`;

  if (sendtoModmail) {
    await reddit.sendPrivateMessageAsSubreddit({
      fromSubredditName: subreddit.name,
      to: appAccount!.username,
      subject: `Edited mod post`,
      text: logMsg,
    });
  }

  const webhook = (await settings.get("webhookEditor")) as string;
  if (webhook) {
    try {
      let payload;
      if (sendtoDiscord) {
        const discordRole = await settings.get("discordRole");
        let discordAlertMessage = discordRole ? `<@&${discordRole}>\n\n` : ``;

        if (webhook.startsWith("https://discord.com/api/webhooks/")) {
          payload = {
            content: discordAlertMessage,
            embeds: [{
              title: `${getPost.title}`,
              url: `https://reddit.com${getPost.permalink}`,
              fields: [
                { name: "Subreddit", value: `r/${subreddit.name}`, inline: true },
                { name: "Moderator", value: `${currentUser?.username}`, inline: true },
                { name: "New post body", value: `${newPostBody}`, inline: true },
                { name: "Reason", value: `${reasonRev}`, inline: true }
              ],
            }],
          };
        }
      }
      if (payload) {
        await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
    } catch (err) {}
  }

  return c.json({ showToast: { text: "Edited!", appearance: "success" } });
};