import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";
import { getVariableTimezone, applyDynamicVariables, extractFlairId } from "../utils/helpers.js";

export const handleSubmitTemplateForm = async (c: Context) => {
  const event = await c.req.json();
  const subreddit = await reddit.getCurrentSubreddit();
  const appAccount = await reddit.getAppUser();
  const currentUser = await reddit.getCurrentUser();

  const rawType = event.postType || event.values?.postType;
  const postType = ((Array.isArray(rawType) ? rawType[0] : rawType) as string) || "text";
  const timezone = await getVariableTimezone();
  const postTitle = applyDynamicVariables(event.finalTitle || event.values?.finalTitle, subreddit, timezone);
  const postUrl = ((event.finalUrl || event.values?.finalUrl) as string || "").trim();
  const postBody = applyDynamicVariables(event.finalBody || event.values?.finalBody, subreddit, timezone);
  const postFlairId = extractFlairId(event.finalFlairId || event.values?.finalFlairId);
  const stickyPost = event.iSticky || event.values?.iSticky;
  const lockPost = event.iLock || event.values?.iLock;

  const setRelayAppPostFlair = (await settings.get("setFlairAfterPosting")) as boolean;
  const relayAppFlairText = (await settings.get("relayAppPostFlairText")) as string;

  if (!postTitle) return c.json({ showToast: { text: "Sorry, no title." } });

  if ((postType === "link" || postType === "media") && !postUrl) {
    return c.json({ showToast: { text: "Link or media URL is required." } });
  }

  const enableDefaultFlair = (await settings.get("enableDefaultFlair")) ?? true;

  if (enableDefaultFlair) {
    await reddit.setUserFlair({
      subredditName: subreddit.name,
      username: appAccount!.username, 
      text: "Mod Team 🛡️",
      textColor: "light",
      backgroundColor: "#2200ff",
    });
  }

  let newPost;

  if (postType === "link" || postType === "media") {
    newPost = await reddit.submitPost({
      subredditName: subreddit.name,
      title: postTitle,
      url: postUrl,
    });

    if (postBody) {
      try {
        await newPost.edit({ text: postBody });
      } catch (e) {
        const fallbackComment = await newPost.addComment({ text: postBody });
        await fallbackComment.distinguish();
        if (postType === "media") {
          try { await (fallbackComment as any).sticky(); } catch (err) {}
        }
      }
    }
  } else {
    newPost = await reddit.submitPost({
      subredditName: subreddit.name,
      title: postTitle,
      text: postBody,
    });
  }

  await newPost.distinguish();
  if (stickyPost) await newPost.sticky();
  if (lockPost) await newPost.lock();

  if (postFlairId) {
    try {
      await reddit.setPostFlair({
        subredditName: subreddit.name,
        postId: newPost.id,
        flairTemplateId: postFlairId,
      });
    } catch (err) {
      console.warn(`[Template Form] Could not apply post flair "${postFlairId}":`, err);
    }
  } else if (setRelayAppPostFlair) {
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

  return c.json({ showToast: { text: "Posted!", appearance: "success" } });
};