import type { Context } from 'hono';
import { reddit } from "@devvit/web/server";
import { getPostFlairOptions } from "../utils/helpers.js";

export const handleSubmitPostMenu = async (c: Context) => {
  const subreddit = await reddit.getCurrentSubreddit();
  const appUser = await reddit.getCurrentUser();
  const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

  if (perms?.includes("posts") || perms?.includes("all")) {
    const flairOptions = await getPostFlairOptions(subreddit.name);
    return c.json({
      showForm: {
        name: "submitModPostForm",
        form: {
          title: "Submit a post",
          acceptLabel: "Post",
          cancelLabel: "Cancel",
          fields: [
            { name: "titleOB", label: "Post title", type: "string", required: true },
            { name: "bodyP", label: "Body", type: "paragraph", required: true },
            ...(flairOptions.length > 0
              ? [{ name: "postFlairId", label: "Post Flair (optional)", type: "select", options: flairOptions, defaultValue: ["none"] }]
              : []),
            { name: "mybDist", label: "Distinguish?", type: "boolean", defaultValue: true, helpText: "All content created by the app is distinguished, so users clearly see they come from the mod team.", disabled: true },
            { name: "iSticky", label: "Sticky?", type: "boolean" },
            { name: "iLock", label: "Lock?", type: "boolean" }
          ]
        }
      }
    });
  } else {
    return c.json({ showToast: { text: "You don't have the necessary permissions." } });
  }
};