import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";

export const handleSubmitCommentForm = async (c: Context) => {
  const event = await c.req.json();
  console.log("RAW FORM PAYLOAD:", JSON.stringify(event, null, 2));
  const subreddit = await reddit.getCurrentSubreddit();
  const appAccount = await reddit.getAppUser();
  const currentUser = await reddit.getCurrentUser();

  const commentBody = event.bodyC || event.values?.bodyC;
  const distinguishComment = event.mybDist || event.values?.mybDist;
  const stickyComment = event.iSticky || event.values?.iSticky;
  const lockComment = event.iLock || event.values?.iLock;
  
  const originalPostOrCommentId = event.targetId;

  const setRelayAppPostFlair = (await settings.get("setFlairAfterCommenting")) as boolean;
  const relayAppFlairText = (await settings.get("relayAppCommentPostFlairText")) as string;

  if (!originalPostOrCommentId) {
    return c.json({ showToast: { text: "Error: Could not identify target for comment." } });
  }

  const newComment = await reddit.submitComment({
    id: originalPostOrCommentId,
    text: `${commentBody}`,
  });
    
  if (distinguishComment) await newComment.distinguish();
  if (stickyComment) await newComment.distinguish(true);
  if (lockComment) await newComment.lock();

  await reddit.addModNote({
    subreddit: subreddit.name,
    user: appAccount!.username,
    label: "SOLID_CONTRIBUTOR",
    redditId: newComment.id,
    note: `${currentUser?.username} created a mod comment.`,
  });

  if (setRelayAppPostFlair) {
    await reddit.setPostFlair({
      subredditName: subreddit.name,
      postId: newComment.postId,
      text: relayAppFlairText,
    });
  }

  return c.json({ showToast: { text: "Posted!", appearance: "success" } });
};