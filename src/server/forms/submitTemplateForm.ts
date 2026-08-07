import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";

export const handleSubmitTemplateForm = async (c: Context) => {
  const event = await c.req.json();
  const subreddit = await reddit.getCurrentSubreddit();
  const appAccount = await reddit.getAppUser();
  const currentUser = await reddit.getCurrentUser();

  const postTitle = event.finalTitle || event.values?.finalTitle;
  const postBody = event.finalBody || event.values?.finalBody;
  const stickyPost = event.iSticky || event.values?.iSticky;
  const lockPost = event.iLock || event.values?.iLock;

  const setRelayAppPostFlair = (await settings.get("setFlairAfterPosting")) as boolean;
  const relayAppFlairText = (await settings.get("relayAppPostFlairText")) as string;

  if (!postTitle) return c.json({ showToast: { text: "Sorry, no title." } });

  const newPost = await reddit.submitPost({
    subredditName: subreddit.name,
    title: postTitle,
    text: postBody,
  });

  await newPost.distinguish();
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
    redditId: newPost.id,
    note: `${currentUser?.username} created a mod post via template (title: ${postTitle}).`,
  });

  // (Standard modmail logic goes here)

  return c.json({ showToast: { text: "Posted!", appearance: "success" } });
};