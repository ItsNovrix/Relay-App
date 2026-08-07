import type { Context } from 'hono';
import { reddit, settings } from "@devvit/web/server";

export const handleAppInstall = async (c: Context) => {
  try {
    const event = await c.req.json();
    console.log(`App install payload received.`);

    const subreddit = await reddit.getCurrentSubreddit();
    const appAccount = await reddit.getAppUser();

    let firstMsg = `Hello r/${subreddit.name} mods,\n\n`;

    firstMsg += `Thanks for installing **Relay App**!\n\n`;
    firstMsg += `Relay App helps your team publish and manage official mod posts and pinned mod comments — fast, consistent, and without shared accounts.\n\n`;

    /* QUICK START */
    firstMsg += `**How to use Relay App:**\n\n\n`;
    firstMsg += `1) Open **Relay App → New Post** or **New Comment**\n`;
    firstMsg += `2) Write your content, toggle **Sticky** / **Lock** as needed\n`;
    firstMsg += `3) **Publish** — done!\n\n`;
    firstMsg += `*Note:* Post titles **cannot be edited** after publishing due to Reddit limitations. Double-check before you post!\n\n`;

    /* DEFAULTS & NOTIFICATIONS */
    firstMsg += `**Defaults & notifications:**\n\n\n`;
    firstMsg += `- An **internal mod note** is added automatically after each publish (shows who posted + direct link).\n`;
    firstMsg += `- **Reply notifications are OFF by default** but can easily be enabled in the app settings.\n`;
    firstMsg += `- **Reply notifications only monitor the first 24 hours** after a post/comment is made by Relay App due to Reddit limitations.\n`;
    firstMsg += `- **Publish/edit notifications are OFF by default** on submit and on edit of a mod post.\n`;
    firstMsg += `- **Discord notifications** are supported if you add a webhook in settings. Heads-up: very long posts may hit Discord payload limits.\n\n`;

    /* FEATURES */
    firstMsg += `**Features you can use today:**\n\n\n`;
    firstMsg += `- Publish **official mod posts** (text) with one-click **Distinguish**, **Sticky**, and **Lock**.\n`;
    firstMsg += `- Publish **official mod comments** (also with **Distinguish**, **Sticky**, and **Lock**).\n`;
    firstMsg += `- **Native Link Posting** — Seamlessly publish native link posts with optional body text.\n`;
    firstMsg += `- **Native Media Posting** — Seamlessly publish native media posts with optional body text.\n`;
    firstMsg += `- **Reply notifications** — Modmail notifications for replies to posts/comments made by Relay App or other specified mod apps.\n`;
    firstMsg += `- **Auto-flair after posting** — Automatically apply a flair (e.g., *Mod Post*) to posts created via Relay App.\n`;
    firstMsg += `- **Auto-flair after commenting** — When a **mod replies via Relay App**, the post flair can auto-switch (e.g., *Mods Replied*).\n`;
    firstMsg += `- **Post Templates** — Save up to **5** reusable templates per subreddit. Add them in settings, then select **Use template** when creating a post.\n`;
    firstMsg += `- **Post Scheduling** — Schedule up to **5** post templates to automatically publish at specific times weekly (with optional **Sticky** and **Lock**).\n`;
    firstMsg += `- **Auto-Unsticky/lock** — Automatically unsticky and/or lock your previous scheduled posts as new ones go live.\n`;
    firstMsg += `- **Clone Post** — Click **Clone** on any previous post to rapidly reuse it (perfect for monthly stickies & AMA re-runs).\n`;
    firstMsg += `- **Permanent delete** of posts/comments created via the app (not just remove) — use with care.\n`;
    firstMsg += `- Permissions required: **Post** or **Everything**.\n\n`;

    /* CONFIG LINKS */
    firstMsg += `**Configure now:** manage templates, auto-flair, and Discord settings here → `;
    firstMsg += `[Relay App settings](https://developers.reddit.com/r/${subreddit.name}/apps/relay-app)\n\n`;

    /* FOOTER */
    firstMsg += `[Terms & Conditions](https://www.reddit.com/r/NovrixApps/wiki/relay-app/terms-and-conditions) | `;
    firstMsg += `[Privacy Policy](https://www.reddit.com/r/NovrixApps/wiki/relay-app/privacy-policy/) | `;
    firstMsg += `[Contact](https://www.reddit.com/r/NovrixApps/)\n\n`;

    await reddit.sendPrivateMessageAsSubreddit({
      fromSubredditName: subreddit.name,
      to: "relay-app",
      subject: `Thanks for installing Relay App!`,
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

    return c.json({ success: true });
  } catch (error) {
    console.error("Crash prevented in AppInstall trigger:", error);
    return c.json({ success: false, error: String(error) }); 
  }
};