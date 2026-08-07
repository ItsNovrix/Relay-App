import type { Context } from 'hono';
import { reddit } from "@devvit/web/server";

export const handleEditPostMenu = async (c: Context) => {
  const event = await c.req.json();
  const subreddit = await reddit.getCurrentSubreddit();
  const appUser = await reddit.getCurrentUser();
  const botAccount = await reddit.getAppUser();
  const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);
  const targetId = event.targetId || event.post?.id;

  if (!targetId) return c.json({ showToast: { text: "Error: No post selected." } });

  const getPost = await reddit.getPostById(targetId);
  
  if (getPost.authorName === botAccount!.username) {
    if (perms?.includes("posts") || perms?.includes("all")) {
      return c.json({
        showForm: {
          name: "editPostForm",
          data: { targetId }, // Pass the post ID to the form submission
          form: {
            title: "Edit post",
            acceptLabel: "Submit",
            cancelLabel: "Cancel",
            fields: [
              { name: "nTitle", label: "Post title", type: "string", defaultValue: getPost.title, helpText: "Post title can't be edited.", disabled: true },
              { name: "nBody", label: "Post body", type: "paragraph", defaultValue: getPost.body ?? "", required: true },
              { name: "reasonRevision", label: "Reason", type: "string" },
              { name: "mybDist", label: "Distinguish?", type: "boolean", defaultValue: getPost.isDistinguishedBy() ? true : false, helpText: "All content created by the app is distinguished...", disabled: true },
              { name: "iSticky", label: "Sticky?", type: "boolean", defaultValue: getPost.isStickied() },
              { name: "iLock", label: "Lock?", type: "boolean", defaultValue: getPost.locked }
            ]
          }
        }
      });
    } else {
      return c.json({ showToast: { text: "You don't have the necessary permissions." } });
    }
  } else {
    return c.json({ showToast: { text: `Sorry, this is not a submission from ${botAccount!.username}!` } });
  }
};