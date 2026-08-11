import type { Context } from 'hono';
import { reddit, settings, scheduler } from "@devvit/web/server";

export const handleAppUpgrade = async (c: Context) => {
  try {
    const event = await c.req.json();
    console.log(`App upgrade payload received.`);

    const subreddit = await reddit.getCurrentSubreddit();
    const appAccount = await reddit.getAppUser();

    let firstMsg = `Hello r/${subreddit.name} mods,\n\n`;

    firstMsg += `Thanks for updating **Relay App**!\n\n`;
    firstMsg += `Relay App helps your team publish and manage official mod posts and mod comments — fast, consistent, and without shared accounts.\n\n`;

    /* WHAT'S NEW */
    firstMsg += `**What's new (highlights):**\n\n\n`;
    firstMsg += `- **Devvit Version Update** — Relay App has been updated to the latest Devvit release (0.14.0).\n`;
    firstMsg += `- **Support Subreddit Update** — r/RelayApp has been sunset, support subreddit has been moved to r/NovrixApps.\n`;
    firstMsg += `- **App Architecture Update** — Relay App has been moved off of previous deprecated Devvit architecture for improved functionality and stability.\n`;
    firstMsg += `- **Post/Comment Editing Update** — Resolved an issue with Relay App not editing posts/comments.\n`;
    firstMsg += `- **App Upgrade Notifier** — Relay App now has an app upgrade notifier to alert mod teams when an upgrade is available for Relay App (this can be toggled off in the app settings).\n\n`;

    /* REMINDERS */
    firstMsg += `**Good to know / reminders:**\n\n\n`;
    firstMsg += `- Titles **cannot be edited** after publishing due to Reddit limitations. Double-check before posting.\n\n`;
    firstMsg += `- An **internal mod note** is automatically added after each publish, showing who posted and linking to the content.\n\n`;
    firstMsg += `- **Reply notifications are OFF by default** but can easily be enabled in the app settings.\n`;
    firstMsg += `- **Reply notifications only monitor the first 24 hours** after a post/comment is made by Relay App due to Reddit limitations.\n`;
    firstMsg += `- **Publish/edit notifications are OFF by default** on submit and on edit of a mod post.\n`;
    firstMsg += `- **Discord notifications** are supported (add your webhook in settings). Note: very long bodies may hit Discord’s payload limits.\n\n`;
    firstMsg += `- You can **permanently delete** posts/comments created by the app (not just remove) — use with care.\n\n`;
    firstMsg += `- To use the app, you need **Post** or **Everything** permissions.\n\n`;

    /* CONFIG LINKS */
    firstMsg += `**Configure now:** manage templates, scheduling, notifications, and more settings here → [Relay App settings](https://developers.reddit.com/r/${subreddit.name}/apps/relay-app)\n\n\n`;

    /* FOOTER */
    firstMsg += `[Terms & Conditions](https://www.reddit.com/r/NovrixApps/wiki/relay-app/terms-and-conditions) | `;
    firstMsg += `[Privacy Policy](https://www.reddit.com/r/NovrixApps/wiki/relay-app/privacy-policy/) | `;
    firstMsg += `[Contact](https://www.reddit.com/r/NovrixApps/)\n\n`;

    await reddit.sendPrivateMessageAsSubreddit({
      fromSubredditName: subreddit.name,
      to: "relay-app",
      subject: `Relay App: App Update`,
      text: firstMsg,
    });
    console.log(`Message sent to r/${subreddit.name} mods.`);
    
      await reddit.setUserFlair({
        subredditName: subreddit.name,
        username: appAccount!.username,
        text: "Mod Team 🛡️",
        textColor: "light",
        backgroundColor: "#2200ff",
      });

      try {
        await scheduler.runJob({
          name: 'upgrade_notifier_job',
          cron: '*/30 * * * *',
        });
        console.log("30-minute upgrade checker timer started.");
      } catch (e) {
        console.error("Failed to start timer:", e);
      }

    return c.json({ success: true });
  } catch (error) {
    console.error("Crash prevented in AppUpgrade trigger:", error);
    return c.json({ success: false, error: String(error) });
  }
};