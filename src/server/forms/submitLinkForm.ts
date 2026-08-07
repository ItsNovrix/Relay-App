import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";

export const handleSubmitLinkForm = async (c: Context) => {
  const event = await c.req.json();
  const subreddit = await reddit.getCurrentSubreddit();
  const appAccount = await reddit.getAppUser();
  const currentUser = await reddit.getCurrentUser();

  const postTitle = event.titleOB || event.values?.titleOB;
  const linkUrl = event.linkUrl || event.values?.linkUrl;
  const postBody = event.bodyP || event.values?.bodyP;
  const distinguishPost = event.mybDist || event.values?.mybDist;
  const stickyPost = event.iSticky || event.values?.iSticky;
  const lockPost = event.iLock || event.values?.iLock;

  const setRelayAppPostFlair = (await settings.get("setFlairAfterPosting")) as boolean;
  const relayAppFlairText = (await settings.get("relayAppPostFlairText")) as string;

  if (!postTitle || !linkUrl) {
    return c.json({ showToast: { text: "Title and link URL are required." } });
  }

  const newPost = await reddit.submitPost({
    subredditName: subreddit.name,
    title: postTitle,
    url: linkUrl,
  });

  if (postBody) {
    try {
      await newPost.edit({ text: postBody });
    } catch (e) {
      const fallbackComment = await newPost.addComment({ text: postBody });
      await fallbackComment.distinguish();
    }
  }

  if (distinguishPost) await newPost.distinguish();
  if (stickyPost) await newPost.sticky();
  if (lockPost) await newPost.lock();

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
    redditId: `t3_${newPost.id}`,
    note: `${currentUser?.username} created a link mod post (title: ${postTitle}).`,
  });

  const sendtoModmail = (await settings.get("sendModmail")) as boolean;
  const sendtoDiscord = (await settings.get("sendDiscord")) as boolean;

  let logMsg = `**Title**: ${newPost.title}\n\n`;
  logMsg += `**URL**: https://reddit.com${newPost.permalink}\n\n`;
  logMsg += `**Moderator**: ${currentUser?.username}\n\n`;
  logMsg += `**Link**: ${linkUrl}\n\n`;
  if (postBody) logMsg += `**Post body**: ${postBody}\n\n`;

  if (sendtoModmail) {
    await reddit.sendPrivateMessageAsSubreddit({
      fromSubredditName: subreddit.name,
      to: appAccount!.username,
      subject: `Mod link post submitted`,
      text: logMsg,
    });
  }

  const webhook = (await settings.get("webhookEditor")) as string;
  if (webhook) {
    try {
      let payload;
      if (sendtoDiscord) {
        const discordRole = await settings.get("discordRole");
        let discordAlertMessage = discordRole ? `<@&${discordRole}>\n\n` : "";

        if (webhook.startsWith("https://discord.com/api/webhooks/")) {
          payload = {
            content: discordAlertMessage,
            embeds: [
              {
                title: `${postTitle}`,
                url: `https://reddit.com${newPost.permalink}`,
                fields: [
                  { name: "Subreddit", value: `r/${subreddit.name}`, inline: true },
                  { name: "Moderator", value: `${currentUser?.username}`, inline: true },
                  { name: "Link URL", value: `${linkUrl}`, inline: false },
                  { name: "Post body", value: postBody ? postBody : "*(Link Only)*", inline: false },
                ],
              },
            ],
          };
        }
      }
      
      if (payload) {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    } catch (err) {
      console.error(`Error sending alert: ${err}`);
    }
  }

  return c.json({ showToast: { text: "Link Posted!", appearance: "success" } });
};