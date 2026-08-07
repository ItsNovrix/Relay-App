import type { Context } from 'hono';
import { reddit } from "@devvit/web/server";

export const handleSubmitMediaMenu = async (c: Context) => {
  const subreddit = await reddit.getCurrentSubreddit();
  const appUser = await reddit.getCurrentUser();
  const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);

  if (perms?.includes("posts") || perms?.includes("all")) {
    return c.json({
      showForm: {
        name: "submitMediaPostForm",
        form: {
          title: "Submit a media post",
          acceptLabel: "Post Media",
          cancelLabel: "Cancel",
          fields: [
            { name: "titleOB", label: "Post title", type: "string", required: true },
            { name: "imageUrl", label: "Direct Media URL", type: "string", required: true, helpText: "Supports direct image links (.jpg, .png, etc.) or video links (YouTube, Vimeo)." },
            { name: "bodyP", label: "Body Text (Optional)", type: "paragraph", required: false },
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