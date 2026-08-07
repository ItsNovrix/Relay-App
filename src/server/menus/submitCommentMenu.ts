import type { Context } from 'hono';
import { reddit } from "@devvit/web/server";

export const handleSubmitCommentMenu = async (c: Context) => {
  const event = await c.req.json();
  console.log("RAW MENU PAYLOAD:", JSON.stringify(event, null, 2));
  const subreddit = await reddit.getCurrentSubreddit();
  const appUser = await reddit.getCurrentUser();
  const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);
  
  // Devvit passes the ID of the post/comment the menu was clicked on inside the event payload
  const targetId = event.targetId || event.post?.id || event.comment?.id;

  if (perms?.includes("posts") || perms?.includes("all")) {
    return c.json({
      showForm: {
        name: "submitCommentReplyForm",
        data: { targetId }, 
        form: {
          title: "Submit a comment",
          acceptLabel: "Publish",
          cancelLabel: "Cancel",
          fields: [
            { name: "targetId", label: "Comment ID", type: "string", defaultValue: targetId, disabled: true },
            { name: "bodyC", label: "Text", type: "paragraph", required: true },
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