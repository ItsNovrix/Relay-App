import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";

export const handleEditCommentForm = async (c: Context) => {
  const event = await c.req.json();
  const subreddit = await reddit.getCurrentSubreddit();
  const appAccount = await reddit.getAppUser();
  const currentUser = await reddit.getCurrentUser();
  
  const rawTargetId = event.data?.targetId || event.targetId;
  const cleanId = rawTargetId.replace(/^t1_/, '');
  
  const getComment = await reddit.getCommentById(`t1_${cleanId}`);
  const oldBody = getComment.body;
  
  const newCommentText = event.nBody || event.values?.nBody;
  const reasonRev = event.reasonRevision || event.values?.reasonRevision || "No reason provided";
  const distinguishComment = event.mybDist ?? event.values?.mybDist;
  const stickyComment = event.iSticky ?? event.values?.iSticky;
  const lockComment = event.iLock ?? event.values?.iLock;

  if (distinguishComment === false) { getComment.undistinguish(); } else { getComment.distinguish(); }
  if (stickyComment === false) { getComment.distinguish(false); } else { getComment.distinguish(true); }
  if (lockComment === false) { await getComment.unlock(); } else { await getComment.lock(); }

  await getComment.edit({ text: newCommentText });

  await reddit.addModNote({
    subreddit: subreddit.name,
    user: appAccount!.username,
    label: "SOLID_CONTRIBUTOR",
    note: `${currentUser?.username} edited mod comment, reason: ${reasonRev}`,
    redditId: `t1_${cleanId}`, // Explicitly defining the prefix exactly like your original code
  });

  const sendtoModmail = (await settings.get("sendModmail")) as boolean;

  let logMsg = `Comment URL: https://reddit.com${getComment.permalink}\n\n`;
  logMsg += `Moderator: ${currentUser?.username}\n\n`;
  logMsg += `Previous version: ${oldBody}\n\n`;
  logMsg += `New version: ${newCommentText}\n\n`;
  logMsg += `Reason for revision: ${reasonRev}\n\n`;

  if (sendtoModmail) {
    await reddit.sendPrivateMessageAsSubreddit({
      fromSubredditName: subreddit.name,
      to: appAccount!.username,
      subject: `Edited mod comment`,
      text: logMsg,
    });
  }

  return c.json({ showToast: { text: "Edited!", appearance: "success" } });
};