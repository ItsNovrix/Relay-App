import type { Context } from 'hono';
import { reddit } from "@devvit/web/server";

export const handleEditCommentMenu = async (c: Context) => {
  const event = await c.req.json();
  console.log("RAW MENU PAYLOAD:", JSON.stringify(event, null, 2));
  const subreddit = await reddit.getCurrentSubreddit();
  const appUser = await reddit.getCurrentUser();
  const botAccount = await reddit.getAppUser();
  const perms = await appUser?.getModPermissionsForSubreddit(subreddit.name);
  
  const rawTargetId = event.targetId || event.comment?.id;
  if (!rawTargetId) return c.json({ showToast: { text: "Error: No comment selected." } });

  const cleanId = rawTargetId.replace(/^t1_/, '');
  const getComment = await reddit.getCommentById(`t1_${cleanId}`);
  
  if (getComment.authorName === botAccount!.username) {
    if (perms?.includes("posts") || perms?.includes("all")) {
      return c.json({
        showForm: {
          name: "editCommentForm",
          data: { targetId: cleanId },
          form: {
            title: "Edit comment",
            acceptLabel: "Submit",
            cancelLabel: "Cancel",
            fields: [
              { name: "targetId", label: "Comment ID", type: "string", defaultValue: rawTargetId, disabled: true },
              { name: "nBody", label: "Comment", type: "paragraph", defaultValue: getComment.body, required: true },
              { name: "reasonRevision", label: "Reason", type: "string" },
              { name: "mybDist", label: "Distinguish?", type: "boolean", defaultValue: getComment.isDistinguished(), helpText: "All content created by the app is distinguished...", disabled: true },
              { name: "iSticky", label: "Sticky?", type: "boolean", defaultValue: getComment.isStickied() },
              { name: "iLock", label: "Lock?", type: "boolean", defaultValue: getComment.locked }
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