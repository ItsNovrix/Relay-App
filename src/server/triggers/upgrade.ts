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
    firstMsg += `- **Post Flair Selection** — Added post flair selection for manual posting and post templates.\n`;
    firstMsg += `- **Dynamic Variable Support** — Added dynamic variable support for manual posting and post templates.\n`;
    firstMsg += `- **Post Templates Update** — Added link / media post type functionality.\n`;
    firstMsg += `- **Post Scheduling Update** — Added daily post scheduling option.\n`;
    firstMsg += `- **Devvit Version Update** — Relay App has been updated to the latest Devvit release (0.15.4).\n\n`;

    /* REMINDERS */
    firstMsg += `**Good to know / reminders:**\n\n\n`;
    firstMsg += `- Titles **cannot be edited** after publishing due to Reddit limitations. Double-check before posting.\n\n`;
    firstMsg += `- An **internal mod note** is automatically added after each publish, showing who posted and linking to the content.\n\n`;
    firstMsg += `- **Reply notifications are OFF by default** but can easily be enabled in the app settings.\n`;
    firstMsg += `- **Reply notifications only monitor the first 24 hours** after a post/comment is made by Relay App due to Reddit limitations.\n`;
    firstMsg += `- **Publish/edit notifications are OFF by default** on submit and on edit of a mod post.\n`;
    firstMsg += `- **Discord notifications** are supported (add your webhook in settings). Note: very long bodies may hit Discord’s payload limits.\n\n`;
    firstMsg += `- **App upgrade notifications are ON by default** but can easily be toggled off in the app settings.\n\n`;
    firstMsg += `- You can **permanently delete** posts/comments created by the app (not just remove) — use with care.\n\n`;
    firstMsg += `- To use the app, you need **Post** or **Everything** permissions.\n\n`;

    /* CONFIG LINKS */
    firstMsg += `**Configure now:** manage templates, scheduling, notifications, and more settings here → [Relay App settings](https://developers.reddit.com/r/${subreddit.name}/apps/relay-app)\n\n\n`;

    /* FOOTER */
    firstMsg += `[Terms & Conditions](https://www.reddit.com/r/NovrixApps/wiki/relay-app/terms-and-conditions) | `;
    firstMsg += `[Privacy Policy](https://www.reddit.com/r/NovrixApps/wiki/relay-app/privacy-policy/) | `;
    firstMsg += `[Feedback/Support](https://reddit.com/r/NovrixApps) | `,
	  firstMsg += `[Novrix Labs Trello Board](https://trello.com/b/1TdocvRg/novrix-labs)\n\n`;

    await reddit.sendPrivateMessageAsSubreddit({
      fromSubredditName: subreddit.name,
      to: "relay-app",
      subject: `Relay App: App Update`,
      text: firstMsg,
    });
    console.log(`Message sent to r/${subreddit.name} mods.`);
    
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